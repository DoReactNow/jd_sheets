// P0-STORE-02, X-DATA-04: keys are made of IDs only and cannot leave the storage root.
import { describe, expect, it } from "vitest";
import { assertStorageKey, workbookVersionKey } from "../keys";

const workbook = "0195f3c2-7a1b-7c3d-8e4f-123456789abc";
const version = "0195f3c2-7a1b-7c3d-8e4f-cba987654321";

describe("workbookVersionKey()", () => {
  it("builds workbooks/<workbookId>/<versionId>.xlsx", () => {
    expect(workbookVersionKey(workbook, version)).toBe(`workbooks/${workbook}/${version}.xlsx`);
  });

  it("refuses anything that is not a UUID, so no title or email can reach a key", () => {
    for (const bad of ["Budget November", "asha@jdfusion.in", "../x", ""]) {
      expect(() => workbookVersionKey(bad, version)).toThrow(/UUID/);
      expect(() => workbookVersionKey(workbook, bad)).toThrow(/UUID/);
    }
  });

  it("refuses a malformed extension", () => {
    expect(() => workbookVersionKey(workbook, version, "x l")).toThrow(/extension/);
  });
});

describe("assertStorageKey()", () => {
  it("accepts keys made of safe segments", () => {
    expect(() => assertStorageKey(`workbooks/${workbook}/${version}.xlsx`)).not.toThrow();
  });

  it.each(["", "/a", "a/../b", "..", "a\\b", "a//b", "a/./b", "a/.hidden", "a/b/", "x".repeat(600), "ä/b"])(
    "rejects %j",
    (bad) => {
      expect(() => assertStorageKey(bad)).toThrow(/storage key/i);
    },
  );
});
