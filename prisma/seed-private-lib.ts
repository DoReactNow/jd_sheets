// The first Super Admin (Decision 28): checks shared by prisma/private/seed.ts (git-ignored) and
// its test. The values come from SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD.
import {
  syncRbac,
  hashPassword,
  isAllowedEmail,
  normalizeEmail,
  passwordProblem,
} from "../src/modules/identity";
import { networkService } from "../src/modules/network";
import { getPrisma } from "../src/shared/db/prisma";

export function checkFirstSuperAdmin(rawEmail: string, password: string): string {
  const email = normalizeEmail(rawEmail);
  if (!isAllowedEmail(email))
    throw new Error("SEED_SUPER_ADMIN_EMAIL must be an @jdfusion.in address");
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(`SEED_SUPER_ADMIN_PASSWORD: ${problem}`);
  return email;
}

/** Roles, the bootstrap network rules, and the first Super Admin if there is none yet. */
export async function runPrivateSeed(
  rawEmail: string | undefined,
  password: string | undefined,
): Promise<string> {
  if (!rawEmail || !password)
    throw new Error("set SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD");
  const email = checkFirstSuperAdmin(rawEmail, password);
  const prisma = getPrisma();
  await syncRbac();
  await networkService.bootstrap();
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  const existing = await prisma.user.findFirst({ where: { roleId: role.id, status: "ACTIVE" } });
  if (existing) return `a Super Admin already exists (${existing.email}); nothing changed`;
  await prisma.user.create({
    data: {
      email,
      displayName: "Owner",
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
      roleId: role.id,
      mustChangePassword: false,
      signupSource: "SEED",
    },
  });
  return `first Super Admin created: ${email}`;
}
