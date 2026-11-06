// Server commands (Decision 15, W-109). Run inside the app container or with the right env file:
//   npm run db:sync-rbac
//   npm run admin:reset-super-admin -- --email <their email>
// The new password is asked for on the terminal (never taken from the command line) and audited
// with actor "system" (P1-RESET-05, -06).
import { createInterface } from "node:readline/promises";
import { recordAudit } from "@/modules/audit";
import { getPrisma } from "@/shared/db/prisma";
import { systemClock } from "@/shared/time";
import { normalizeEmail } from "./identity.email";
import { assertPasswordAllowed, hashPassword } from "./identity.passwords";
import { syncRbac } from "./identity.rbac";
import { identityRepository } from "./identity.repository";

export async function resetSuperAdminPassword(email: string, newPassword: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const user = await identityRepository.findAuthUserByEmail(normalized);
  if (!user || user.status !== "ACTIVE" || user.role?.key !== "SUPER_ADMIN") {
    throw new Error(`${normalized} is not an active Super Admin`);
  }
  assertPasswordAllowed(newPassword, normalized);
  const passwordHash = await hashPassword(newPassword);
  const now = systemClock.now();
  await identityRepository.transaction(async (tx) => {
    await identityRepository.updateUser(tx, user.id, {
      passwordHash,
      mustChangePassword: true,
      failedSignInCount: 0,
      lockedUntil: null,
      passwordChangedAt: now,
    });
    await identityRepository.revokeAllSessions(tx, user.id, now);
    await recordAudit(tx, {
      action: "user.password_reset",
      targetType: "user",
      targetId: user.id,
      actorId: null,
      actorKind: "SYSTEM",
      details: { via: "recovery command" },
    });
  });
}

async function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as {
    _writeToOutput?: (text: string) => void;
    output: NodeJS.WriteStream;
  };
  output._writeToOutput = (text: string) => {
    if (text.includes(question)) process.stdout.write(text);
  };
  const answer = await rl.question(question);
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "sync-rbac") {
      const summary = await syncRbac();
      console.log(
        `[rbac] roles created: ${summary.rolesCreated.join(", ") || "none"}; grants added: ${summary.grantsAdded}`,
      );
    } else if (command === "reset-super-admin") {
      const index = args.indexOf("--email");
      const email = index >= 0 ? args[index + 1] : undefined;
      if (!email)
        throw new Error("usage: npm run admin:reset-super-admin -- --email <name@domain>");
      const first = await askHidden("New password: ");
      const second = await askHidden("Repeat the new password: ");
      if (first !== second) throw new Error("the two passwords differ");
      await resetSuperAdminPassword(email, first);
      console.log(
        "[admin] password reset; they must change it at their next sign-in, and every session was ended",
      );
    } else {
      throw new Error("unknown command");
    }
  } catch (error) {
    console.error(`[admin] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await getPrisma().$disconnect();
  }
}

if (require.main === module) void main();
