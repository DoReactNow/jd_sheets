// The "identity card" built on the server for every request (Decision 16).
import type { PermissionCode } from "./permissionRegistry";

export interface Principal {
  readonly userId: string;
  /** Shown as the author of comments in the editor (Decision 23). */
  readonly displayName: string;
  readonly roleCode: string;
  /** True only for SUPER_ADMIN. Read only by the guard. */
  readonly bypassesAccess: boolean;
  readonly permissions: ReadonlySet<PermissionCode>;
}
