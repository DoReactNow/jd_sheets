// The "identity card" built on the server for every request (Decision 16).
import type { PermissionCode } from "./permissionRegistry";

export interface Principal {
  readonly userId: string;
  /** Shown as the author of comments in the editor (Decision 23). */
  readonly displayName: string;
  readonly email: string;
  readonly roleCode: string;
  /** True only for SUPER_ADMIN. Read only by the guard. */
  readonly bypassesAccess: boolean;
  readonly permissions: ReadonlySet<PermissionCode>;
  /** The session this request came with (null for test principals). */
  readonly sessionId: string | null;
  /** Until changed, only the change-password screen and its API work (Decision 14). */
  readonly mustChangePassword: boolean;
}
