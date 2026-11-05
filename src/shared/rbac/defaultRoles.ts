// Default bundles of the system roles (Decision 16, project_data.md Section 5.3–5.4).
// `db:sync-rbac` (Phase 1) applies them and never overwrites grants edited later.
import type { PermissionCode } from "./permissionRegistry";

export interface RoleDefinition {
  name: string;
  description: string;
  /** Only SUPER_ADMIN: passes every global permission check. Read only by the guard. */
  bypassesAccess: boolean;
  permissions: readonly PermissionCode[];
}

export const SYSTEM_ROLE_CODES = ["SUPER_ADMIN", "ADMIN", "MEMBER"] as const;
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export const DEFAULT_ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Runs JD Sheets: everything, including network access and the admins.",
    bypassesAccess: true,
    permissions: [],
  },
  ADMIN: {
    name: "Admin",
    description: "Approves accounts, manages users and groups, and sees the audit trail.",
    bypassesAccess: false,
    permissions: [
      "workbooks:create",
      "users:view",
      "users:create",
      "users:edit",
      "users:deactivate",
      "users:approve",
      "users:reset-password",
      "groups:manage",
      "network:view",
      "audit:view",
    ],
  },
  MEMBER: {
    name: "Member",
    description: "Creates workbooks and works on what is shared with them.",
    bypassesAccess: false,
    permissions: ["workbooks:create"],
  },
} as const satisfies Record<SystemRoleCode, RoleDefinition>;
