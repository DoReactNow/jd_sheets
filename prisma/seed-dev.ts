// Development seed (Decision 28, 48): development users with known development passwords, and a
// few sample workbooks, so the local app has something to show. Refused outside development.
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPrincipal, hashPassword, syncRbac } from "../src/modules/identity";
import { workbooksService } from "../src/modules/workbooks/workbooks.instance";
import { getEnv } from "../src/shared/config/env";
import { getPrisma } from "../src/shared/db/prisma";
import type { SystemRoleCode } from "../src/shared/rbac/defaultRoles";

/** Development only; refused anywhere else. Not secret: the database is local. */
export const DEV_PASSWORD = "Dev-Pass-2027!local";

const USERS: Array<{ email: string; name: string; role: SystemRoleCode }> = [
  { email: "owner.dev@jdfusion.in", name: "Owner (dev)", role: "SUPER_ADMIN" },
  { email: "admin.dev@jdfusion.in", name: "Kavya (dev admin)", role: "ADMIN" },
  { email: "asha.dev@jdfusion.in", name: "Asha (dev)", role: "MEMBER" },
  { email: "rahul.dev@jdfusion.in", name: "Rahul (dev)", role: "MEMBER" },
];

const SAMPLES = [
  { title: "Sample: formulas", file: "formulas.xlsx" },
  { title: "Sample: several sheets", file: "sheets.xlsx" },
];

async function main(): Promise<void> {
  const env = getEnv();
  if (env.APP_ENV !== "development") throw new Error("db:seed:dev only runs in development");
  const prisma = getPrisma();
  await syncRbac();
  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const user of USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: user.role } });
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        email: user.email,
        displayName: user.name,
        passwordHash,
        status: "ACTIVE",
        roleId: role.id,
        signupSource: "SEED",
      },
    });
  }
  console.log(
    `[seed-dev] users: ${USERS.map((u) => u.email).join(", ")} (password: ${DEV_PASSWORD})`,
  );

  const asha = await prisma.user.findUniqueOrThrow({
    where: { email: "asha.dev@jdfusion.in" },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      mustChangePassword: true,
      role: {
        select: { key: true, bypassesAccess: true, permissions: { select: { permission: true } } },
      },
    },
  });
  const principal = buildPrincipal(asha, null);
  const existing = await prisma.workbook.findMany({
    where: { ownerId: asha.id },
    select: { title: true },
  });
  for (const sample of SAMPLES) {
    if (existing.some((workbook) => workbook.title === sample.title)) continue;
    const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "golden", sample.file)));
    await workbooksService().createFromBytes(principal, sample.title, bytes);
    console.log(`[seed-dev] created "${sample.title}" for ${asha.email}`);
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(`[seed-dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
