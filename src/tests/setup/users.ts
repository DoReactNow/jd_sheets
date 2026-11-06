// Integration-test people: real rows in the test database, built through the identity module, so
// tests see real roles, permissions and statuses (Rule 17). Passwords come from .env.test.
import { randomUUID } from "node:crypto";
import { buildPrincipal, hashPassword, syncRbac } from "@/modules/identity";
import { getPrisma } from "@/shared/db/prisma";
import type { SystemRoleCode } from "@/shared/rbac/defaultRoles";
import type { Principal } from "@/shared/rbac/principal";
import { setPrincipalResolverForTests } from "@/shared/rbac/principalResolver";
import { resetDatabase } from "./resetDatabase";

// The test password, read where tests may read the environment.
 
export const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? "Test-Pass-2027!x";

let passwordHash: Promise<string> | undefined;

/** Empties the test database and writes the system roles again. */
export async function resetWithRoles(): Promise<void> {
  await resetDatabase();
  await syncRbac();
}

export interface TestUser {
  id: string;
  email: string;
  principal: Principal;
}

export async function createTestUser(
  options: {
    role?: SystemRoleCode | null;
    status?: "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "DEACTIVATED";
    email?: string;
    displayName?: string;
    mustChangePassword?: boolean;
    password?: string;
  } = {},
): Promise<TestUser> {
  const prisma = getPrisma();
  const role = options.role === undefined ? "MEMBER" : options.role;
  const status = options.status ?? "ACTIVE";
  const email = options.email ?? `user-${randomUUID().slice(0, 8)}.test@jdfusion.in`;
  const hash = options.password
    ? await hashPassword(options.password)
    : await (passwordHash ??= hashPassword(TEST_PASSWORD));
  const roleRow = role ? await prisma.role.findUniqueOrThrow({ where: { key: role } }) : null;
  const user = await prisma.user.create({
    data: {
      email,
      displayName: options.displayName ?? `Test ${role ?? "person"}`,
      passwordHash: hash,
      status,
      roleId: status === "ACTIVE" ? (roleRow?.id ?? null) : (roleRow?.id ?? null),
      mustChangePassword: options.mustChangePassword ?? false,
      signupSource: "SEED",
    },
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
  return { id: user.id, email: user.email, principal: buildPrincipal(user, null) };
}

/** Every following route() call in this test process resolves to this principal (null = signed out). */
export function actAs(principal: Principal | null): void {
  setPrincipalResolverForTests(async () => principal);
}

export function stopActing(): void {
  setPrincipalResolverForTests(null);
}
