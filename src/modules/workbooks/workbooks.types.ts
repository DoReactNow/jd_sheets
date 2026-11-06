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
  owner: { id: string; displayName: string } | null;
  /** Set only in the Trash. */
  trashedAt: string | null;
  /** Recent list: when the caller last opened it. */
  openedAt?: string;
}

export interface WorkbookPageDto {
  items: WorkbookDto[];
  /** Pass back as `cursor` for the next page; null on the last page (X-LIST-05). */
  nextCursor: string | null;
}

export interface SavedVersionDto {
  versionId: string;
  number: number;
  sizeBytes: number;
  savedAt: string;
}
