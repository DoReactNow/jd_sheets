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

/** One entry of the version history (P2-VER-01). */
export interface VersionDto {
  id: string;
  number: number;
  name: string | null;
  source: "CREATE" | "SAVE" | "AUTOSAVE" | "IMPORT" | "RESTORE" | "LIVE_SNAPSHOT";
  createdBy: { id: string; displayName: string } | null;
  /** Live editing snapshots: everyone whose changes it holds (Decision 56). */
  contributors: Array<{ id: string; displayName: string }>;
  createdAt: string;
  sizeBytes: number;
  /** For a restore: the number of the version it brought back, when that still exists. */
  restoredFromNumber: number | null;
  current: boolean;
}

export interface VersionPageDto {
  items: VersionDto[];
  nextCursor: string | null;
}

/** What an administrator sees of any workbook: never its content (P2-ADMINWB-01). */
export interface AdminWorkbookDto {
  id: string;
  title: string;
  sizeBytes: number;
  updatedAt: string;
  trashedAt: string | null;
  owner: { id: string; displayName: string; email: string; active: boolean } | null;
}
