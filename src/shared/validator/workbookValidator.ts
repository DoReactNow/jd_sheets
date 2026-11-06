// Checks a workbook before it is stored (Decision 11): size, file signature, and a real open by
// GridCraft's engine in the Rust service. Chosen by WORKBOOK_VALIDATOR; tests use "fake" except
// the contract and E2E tests, which run the real service.
export interface WorkbookSummary {
  sheets: string[];
}

export interface WorkbookValidator {
  readonly driver: string;
  /**
   * Resolves with a summary, or throws AppError WORKBOOK_TOO_LARGE, WORKBOOK_UNREADABLE or
   * SERVICE_UNAVAILABLE. Never stores anything.
   */
  validate(bytes: Uint8Array): Promise<WorkbookSummary>;
  /** A new, empty workbook (one sheet) as XLSX bytes. */
  blank(): Promise<Uint8Array>;
  /**
   * What changed from `base` to `next` for a save by `author` (their display name), checked by
   * GridCraft's engine (project_data.md 5.5). Throws like validate().
   */
  diffKind(base: Uint8Array, next: Uint8Array, author: string): Promise<DiffKind>;
  /**
   * An imported file (`extension` one of APP_CONFIG.workbooks.importExtensions) as XLSX bytes.
   * Throws WORKBOOK_TOO_LARGE, WORKBOOK_UNREADABLE or SERVICE_UNAVAILABLE.
   */
  convert(bytes: Uint8Array, extension: string): Promise<Uint8Array>;
}

/** NONE: only the view; COMMENTS_ONLY; FOREIGN_COMMENT: someone else's comment; OTHER: content. */
export type DiffKind = "NONE" | "COMMENTS_ONLY" | "FOREIGN_COMMENT" | "OTHER";
