// File storage (Decision 19). Use getFileStorage(); never import a driver directly.
export type { FileStorage, StoredFile } from "./fileStorage";
export { assertStorageKey, workbookVersionKey, WORKBOOKS_PREFIX } from "./keys";
export { createFileStorage, getFileStorage, type StorageConfig } from "./registry";
