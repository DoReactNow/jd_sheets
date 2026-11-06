// Roles in the database (Decisions 16, 48): `db:sync-rbac` writes the system roles and their default
// grants, idempotently, and never removes or overwrites a grant (P1-SEED-03). The principal is
// built from the database on every request.
import { DEFAULT_ROLES, SYSTEM_ROLE_CODES } from "@/shared/rbac/defaultRoles";
import {
  isPermissionCode,
  RESERVED_PERMISSION_CODES,
  type PermissionCode,
} from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { identityRepository, type PrincipalUser } from "./identity.repository";

export interface SyncSummary {
  rolesCreated: string[];
  grantsAdded: number;
}

export async function syncRbac(): Promise<SyncSummary> {
  const summary: SyncSummary = { rolesCreated: [], grantsAdded: 0 };
  for (const key of SYSTEM_ROLE_CODES) {
    const definition = DEFAULT_ROLES[key];
    let role = await identityRepository.findRole(key);
    if (!role) {
      role = await identityRepository.createRole({
        key,
        name: definition.name,
        bypassesAccess: definition.bypassesAccess,
      });
      summary.rolesCreated.push(key);
    }
    for (const permission of definition.permissions as readonly PermissionCode[]) {
      if (RESERVED_PERMISSION_CODES.includes(permission)) continue;
      if (await identityRepository.addGrantIfMissing(role.id, permission)) summary.grantsAdded++;
    }
  }
  return summary;
}

/** The principal of an active user. Unknown codes in the database are ignored. */
export function buildPrincipal(user: PrincipalUser, sessionId: string | null): Principal {
  const permissions = new Set<PermissionCode>(
    (user.role?.permissions ?? []).map((grant) => grant.permission).filter(isPermissionCode),
  );
  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    roleCode: user.role?.key ?? "NONE",
    bypassesAccess: user.role?.bypassesAccess ?? false,
    permissions,
    sessionId,
    mustChangePassword: user.mustChangePassword,
  };
}
