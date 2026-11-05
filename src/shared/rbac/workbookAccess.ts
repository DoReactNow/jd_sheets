// Workbook roles and what each may do (Decision 17, project_data.md Section 5.5). Separate from
// global permissions: the Super Admin bypass does NOT grant a workbook role.
// The composition root installs the resolver (the `sharing` module from Phase 2; the Phase 0
// development resolver until then), so shared code never imports a module.
import type { Principal } from "./principal";

export const WORKBOOK_ROLES = ["OWNER", "EDITOR", "COMMENTER", "VIEWER"] as const;
export type WorkbookRole = (typeof WORKBOOK_ROLES)[number];

export const WORKBOOK_CAPABILITIES = [
  "read",
  "comment",
  "edit",
  "history",
  "share",
  "own",
] as const;
export type WorkbookCapability = (typeof WORKBOOK_CAPABILITIES)[number];

const MATRIX: Record<WorkbookRole, ReadonlySet<WorkbookCapability>> = {
  OWNER: new Set(["read", "comment", "edit", "history", "share", "own"]),
  EDITOR: new Set(["read", "comment", "edit", "history"]),
  COMMENTER: new Set(["read", "comment", "history"]),
  VIEWER: new Set(["read"]),
};

export function roleAllows(role: WorkbookRole, capability: WorkbookCapability): boolean {
  return MATRIX[role].has(capability);
}

/** The highest of several roles (owner > editor > commenter > viewer), or null for none. */
export function highestRole(roles: Iterable<WorkbookRole | null | undefined>): WorkbookRole | null {
  let best: WorkbookRole | null = null;
  for (const role of roles) {
    if (!role) continue;
    if (best === null || WORKBOOK_ROLES.indexOf(role) < WORKBOOK_ROLES.indexOf(best)) best = role;
  }
  return best;
}

/** The person's effective role on a workbook, or null when they have none (→ NOT_FOUND). */
export type WorkbookRoleResolver = (
  principal: Principal,
  workbookId: string,
) => Promise<WorkbookRole | null>;

const holder = globalThis as unknown as { jdsheetsWorkbookRoleResolver?: WorkbookRoleResolver };

export function configureWorkbookRoleResolver(resolver: WorkbookRoleResolver): void {
  holder.jdsheetsWorkbookRoleResolver = resolver;
}

/** No resolver configured means nobody has a role on anything (deny by default). */
export function resolveWorkbookRole(
  principal: Principal,
  workbookId: string,
): Promise<WorkbookRole | null> {
  return holder.jdsheetsWorkbookRoleResolver?.(principal, workbookId) ?? Promise.resolve(null);
}
