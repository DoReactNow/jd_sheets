// Storage keys are ours and never contain personal data or titles (Decision 19, X-DATA-04):
// "workbooks/<workbookId>/<versionId>.xlsx". The same key works on every driver.

const MAX_KEY_LENGTH = 512;
/** ASCII letters, digits, ".", "_" and "-"; a segment may not start with "." (no "..", no hidden files). */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Throws unless `key` is a relative path of safe segments that cannot leave the storage root. */
export function assertStorageKey(key: string): void {
  const valid =
    key.length > 0 &&
    key.length <= MAX_KEY_LENGTH &&
    key.split("/").every((segment) => SEGMENT.test(segment));
  if (!valid) throw new Error(`Invalid storage key ${JSON.stringify(key.slice(0, 80))}`);
}

/** Where one version of a workbook is stored. Both parts must be UUIDs. */
export function workbookVersionKey(workbookId: string, versionId: string, extension = "xlsx"): string {
  if (!UUID.test(workbookId) || !UUID.test(versionId)) {
    throw new Error("Storage key IDs must be UUIDs (keys never contain personal data)");
  }
  if (!/^[a-z0-9]{1,8}$/.test(extension)) throw new Error(`Invalid storage key extension "${extension}"`);
  const key = `workbooks/${workbookId}/${versionId}.${extension}`;
  assertStorageKey(key);
  return key;
}

/** The prefix under which every workbook version is stored. */
export const WORKBOOKS_PREFIX = "workbooks";
