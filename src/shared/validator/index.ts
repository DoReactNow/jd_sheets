// Workbook validation (Decision 11). Use getWorkbookValidator(); never import a driver directly.
export type { DiffKind, WorkbookSummary, WorkbookValidator } from "./workbookValidator";
export { createWorkbookValidator, getWorkbookValidator } from "./registry";
export { minimalXlsx, writeZip, zipEntryNames, type FakeComment } from "./zip";
