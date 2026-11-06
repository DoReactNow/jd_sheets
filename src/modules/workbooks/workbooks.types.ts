import type { WorkbookRole } from "@/shared/rbac/workbookAccess";

/** A workbook as lists and the editor page see it. Instants are ISO-8601 UTC strings. */
export interface WorkbookDto {
  id: string;
  title: string;
  sizeBytes: number;
  currentVersionId: string;
  currentVersionNumber: number;
  createdAt: string;
  updatedAt: string;
  /** The caller's role on it. */
  role: WorkbookRole;
}

export interface SavedVersionDto {
  versionId: string;
  number: number;
  sizeBytes: number;
  savedAt: string;
}
