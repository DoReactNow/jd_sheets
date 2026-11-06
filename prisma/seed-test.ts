// The test seed (Decision 28): runs against the TEST database only, after the migrations. It
// writes the roles and one user per role and status, all *.test@jdfusion.in, with the password
// from .env.test (P1-SEED-01). E2E signs in as these people.
import { hashPassword, syncRbac } from "../src/modules/identity";
import { getEnv } from "../src/shared/config/env";
import { getPrisma } from "../src/shared/db/prisma";

export const TEST_USERS = [
  {
    email: "superadmin.test@jdfusion.in",
    name: "Test Super Admin",
    role: "SUPER_ADMIN",
    status: "ACTIVE",
  },
  { email: "admin.test@jdfusion.in", name: "Test Admin", role: "ADMIN", status: "ACTIVE" },
  { email: "member.test@jdfusion.in", name: "Test Member", role: "MEMBER", status: "ACTIVE" },
  { email: "member2.test@jdfusion.in", name: "Test Member Two", role: "MEMBER", status: "ACTIVE" },
  {
    email: "pending.test@jdfusion.in",
    name: "Test Pending",
    role: null,
    status: "PENDING_APPROVAL",
  },
  { email: "rejected.test@jdfusion.in", name: "Test Rejected", role: null, status: "REJECTED" },
  {
    email: "deactivated.test@jdfusion.in",
    name: "Test Deactivated",
    role: "MEMBER",
    status: "DEACTIVATED",
  },
] as const;

export async function runTestSeed(): Promise<void> {
  const env = getEnv();
  if (env.APP_ENV !== "test" || !env.databaseName.endsWith("_test")) {
    throw new Error("The test seed only runs against a _test database with APP_ENV=test");
  }
  const prisma = getPrisma();
  await syncRbac();
   
  const password = process.env.TEST_USER_PASSWORD;
  if (!password) throw new Error("TEST_USER_PASSWORD is missing from .env.test");
  const passwordHash = await hashPassword(password);
  // The network rules E2E runs with: only this machine (journey 6 comes from another address).
  await prisma.ipRule.deleteMany();
  await prisma.ipRule.createMany({
    data: [
      { cidr: "127.0.0.1/32", label: "This machine (IPv4)" },
      { cidr: "::1/128", label: "This machine (IPv6)" },
    ],
  });
  for (const user of TEST_USERS) {
    const role = user.role
      ? await prisma.role.findUniqueOrThrow({ where: { key: user.role } })
      : null;
    const data = {
      displayName: user.name,
      passwordHash,
      status: user.status,
      roleId: role?.id ?? null,
      mustChangePassword: false,
      failedSignInCount: 0,
      lockedUntil: null,
    };
    await prisma.user.upsert({
      where: { email: user.email },
      update: data,
      create: { email: user.email, signupSource: "SEED", ...data },
    });
  }
}

if (require.main === module) {
  runTestSeed().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
