// Every permission code lives here and nowhere else (Decision 16, project_data.md Section 5.4).
// A feature adds its codes here first, then guards its routes with them. `db:sync-rbac` (Phase 1)
// writes this list to the database.

export interface PermissionDefinition {
  /** Human-readable name, shown on admin screens. */
  label: string;
  description: string;
  /** Owning module, for grouping. */
  module: string;
  /** Reserved codes are never granted to any role; only the Super Admin bypass reaches them. */
  reserved: boolean;
}

export const PERMISSIONS = {
  "workbooks:create": {
    label: "Create workbooks",
    description: "Create new workbooks and import files as workbooks.",
    module: "workbooks",
    reserved: false,
  },
  "workbooks:administer": {
    label: "Administer workbooks",
    description:
      "See every workbook's details, transfer ownership, delete, and open as administrator (audited).",
    module: "workbooks",
    reserved: false,
  },
  "users:view": {
    label: "View users",
    description: "See the list of users and their details.",
    module: "identity",
    reserved: false,
  },
  "users:create": {
    label: "Create users",
    description: "Create accounts with a temporary password.",
    module: "identity",
    reserved: false,
  },
  "users:edit": {
    label: "Edit users",
    description: "Change a user's name and role.",
    module: "identity",
    reserved: false,
  },
  "users:deactivate": {
    label: "Deactivate users",
    description: "Deactivate and reactivate users. Deactivating signs them out everywhere.",
    module: "identity",
    reserved: false,
  },
  "users:approve": {
    label: "Approve sign-ups",
    description: "Approve or reject requests for an account.",
    module: "identity",
    reserved: false,
  },
  "users:reset-password": {
    label: "Reset passwords",
    description: "Set a temporary password for a user. Signs them out everywhere.",
    module: "identity",
    reserved: false,
  },
  "groups:manage": {
    label: "Manage groups",
    description: "Create groups and manage their members.",
    module: "identity",
    reserved: false,
  },
  "network:view": {
    label: "View network access",
    description: "See the allowed networks and blocked requests.",
    module: "network",
    reserved: false,
  },
  "network:manage": {
    label: "Manage network access",
    description: "Change which networks can reach JD Sheets.",
    module: "network",
    reserved: false,
  },
  "audit:view": {
    label: "View audit trail",
    description: "See who did what, and when.",
    module: "audit",
    reserved: false,
  },
  "system:diagnostics": {
    label: "View diagnostics",
    description: "See the health of the app, worker, collab service and database.",
    module: "system",
    reserved: false,
  },
  "users:manage-super-admins": {
    label: "Manage Super Admins",
    description: "Create, edit, reset or demote Super Admins.",
    module: "identity",
    reserved: true,
  },
  "roles:manage": {
    label: "Manage roles",
    description: "Change what each role may do.",
    module: "identity",
    reserved: true,
  },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];
export const RESERVED_PERMISSION_CODES = PERMISSION_CODES.filter(
  (code) => PERMISSIONS[code].reserved,
);

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === "string" && Object.hasOwn(PERMISSIONS, value);
}
