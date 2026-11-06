// Public API of the sharing module.
import type { Principal } from "@/shared/rbac/principal";
import type { WorkbookRole } from "@/shared/rbac/workbookAccess";
import { sharingService } from "./sharing.service";

export type { GrantDto, SharingDto, ShareRoleCode, ShareTargetsDto } from "./sharing.types";
export { createSharingService } from "./sharing.service";

/** The workbook role resolver installed by src/instrumentation.ts (replaces the Phase 0 one). */
export function resolveWorkbookRoleWithSharing(
  principal: Principal,
  workbookId: string,
): Promise<WorkbookRole | null> {
  return sharingService.resolveRole(principal, workbookId);
}
