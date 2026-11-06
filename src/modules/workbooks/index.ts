// Public API of the workbooks module.
import type { Principal } from "@/shared/rbac/principal";
import type { WorkbookRole } from "@/shared/rbac/workbookAccess";
import { workbooksService } from "./workbooks.instance";

export type { SavedVersionDto, WorkbookDto } from "./workbooks.types";
export { workbookRecords, type Tx as WorkbookTx } from "./workbooks.repository";
export { leaseService, workbooksService } from "./workbooks.instance";
export { purgeOrphanFilesJob, workbookJobs, workbookSchedules } from "./workbooks.jobs";

/** The Phase 0 workbook role resolver (owner only), installed by src/instrumentation.ts. */
export function resolveWorkbookRoleForOwner(
  principal: Principal,
  workbookId: string,
): Promise<WorkbookRole | null> {
  return workbooksService().roleOf(principal, workbookId);
}
