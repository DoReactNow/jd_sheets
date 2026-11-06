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
}
