// A principal for unit tests that never touch the database.
import { DEFAULT_ROLES, type SystemRoleCode } from "@/shared/rbac/defaultRoles";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";

export function fakePrincipal(
  overrides: Partial<Principal> & { role?: SystemRoleCode } = {},
): Principal {
  const role = overrides.role ?? "MEMBER";
  const definition = DEFAULT_ROLES[role];
  return {
    userId: "0190f1e2-0000-7000-8000-00000000aaaa",
    displayName: "Test Person",
    email: "person.test@jdfusion.in",
    roleCode: role,
    bypassesAccess: definition.bypassesAccess,
    permissions: new Set<PermissionCode>(definition.permissions),
    sessionId: null,
    mustChangePassword: false,
    ...overrides,
  };
}
