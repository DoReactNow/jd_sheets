// The behaviour every WorkbookValidator must share (Decision 11, P0-VAL-01..05). The fake runs it
// in the unit tests; the collab driver runs it against the real Rust service (contract tests).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { WorkbookValidator } from "../workbookValidator";
import { minimalXlsx, writeZip } from "../zip";

const golden = (name: string) =>
  new Uint8Array(readFileSync(path.join(process.cwd(), "golden", `${name}.xlsx`)));

export function runValidatorContract(name: string, validator: () => WorkbookValidator): void {
  describe(`WorkbookValidator contract: ${name}`, () => {
    it("accepts a minimal workbook and a GridCraft-written one (P0-VAL-01)", async () => {
      await expect(validator().validate(minimalXlsx({ A1: "5" }))).resolves.toMatchObject({
        sheets: expect.arrayContaining(["Sheet1"]),
      });
      await expect(validator().validate(golden("basics"))).resolves.toBeTruthy();
    });

    it("makes a blank workbook that it then accepts", async () => {
      const blank = await validator().blank();
      expect(Buffer.from(blank.subarray(0, 2)).toString()).toBe("PK");
      await expect(validator().validate(blank)).resolves.toMatchObject({ sheets: expect.any(Array) });
    });

    it("refuses a file that is not a ZIP (P0-VAL-02)", async () => {
      await expect(validator().validate(new TextEncoder().encode("hello"))).rejects.toMatchObject({
        code: "WORKBOOK_UNREADABLE",
      });
    });

    it("refuses a ZIP that is not a workbook (P0-VAL-03)", async () => {
      const zip = writeZip({ "readme.txt": "just a zip" });
      await expect(validator().validate(zip)).rejects.toMatchObject({ code: "WORKBOOK_UNREADABLE" });
    });

    it("refuses a truncated workbook (P0-VAL-04)", async () => {
      const bytes = golden("formulas");
      await expect(validator().validate(bytes.subarray(0, bytes.length / 2))).rejects.toMatchObject({
        code: "WORKBOOK_UNREADABLE",
      });
    });

    it("refuses a workbook over the size limit without sending it anywhere (P0-VAL-05)", async () => {
      const big = new Uint8Array(APP_CONFIG.workbooks.maxBytes + 1);
      await expect(validator().validate(big)).rejects.toMatchObject({ code: "WORKBOOK_TOO_LARGE" });
    });
  });
}
