// Test principals. Phase 0 has no users table, so a principal is built from the role's default
// bundle (defaultRoles.ts). Phase 1 switches this to the identity module's real resolver.
import { randomUUID } from "node:crypto";
import { DEFAULT_ROLES, type SystemRoleCode } from "@/shared/rbac/defaultRoles";
import type { Principal } from "@/shared/rbac/principal";
import { setPrincipalResolverForTests } from "@/shared/rbac/principalResolver";

export type TestRole = SystemRoleCode;

export function testPrincipal(roleCode: TestRole, userId: string = randomUUID()): Principal {
  const role = DEFAULT_ROLES[roleCode];
  return {
    userId,
    displayName: `Test ${role.name}`,
    roleCode,
    bypassesAccess: role.bypassesAccess,
    permissions: new Set(role.permissions),
  };
}

/** Every following route() call in this test process resolves to this principal (null = signed out). */
export function actAs(principal: Principal | null): void {
  setPrincipalResolverForTests(async () => principal);
}

export function stopActing(): void {
  setPrincipalResolverForTests(null);
}
