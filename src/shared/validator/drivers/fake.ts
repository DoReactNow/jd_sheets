// The "fake" validator for unit and integration tests: checks the size and that the bytes are a
// ZIP holding the parts every XLSX has. Only the registry imports this file.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import type { WorkbookValidator } from "../workbookValidator";
import {
  FAKE_COMMENTS_PART,
  fakeComments,
  minimalXlsx,
  storedEntries,
  zipEntryNames,
} from "../zip";

const REQUIRED_PARTS = ["[Content_Types].xml", "xl/workbook.xml"];

export function createFakeValidator(): WorkbookValidator {
  return {
    driver: "fake",
    async validate(bytes) {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes)
        throw new AppError("WORKBOOK_TOO_LARGE");
      const names = zipEntryNames(bytes);
      if (!names || !REQUIRED_PARTS.every((part) => names.includes(part))) {
        throw new AppError("WORKBOOK_UNREADABLE");
      }
      return { sheets: ["Sheet1"] };
    },
    async blank() {
      return minimalXlsx();
    },
    // Compares our own fake packages part by part; comments live in one part (see minimalXlsx).
    async diffKind(base, next, author) {
      const a = storedEntries(base);
      const b = storedEntries(next);
      if (!a || !b) throw new AppError("WORKBOOK_UNREADABLE");
      const names = new Set([...a.keys(), ...b.keys()]);
      names.delete(FAKE_COMMENTS_PART);
      for (const name of names) if (a.get(name) !== b.get(name)) return "OTHER";
      const before = fakeComments(a.get(FAKE_COMMENTS_PART));
      const after = fakeComments(b.get(FAKE_COMMENTS_PART));
      const key = (c: { cell: string; author: string; text: string }) =>
        `${c.cell}\u0000${c.author}\u0000${c.text}`;
      if (before.map(key).join("\n") === after.map(key).join("\n")) return "NONE";
      const kept = new Set(after.map(key));
      const foreign = before.some((c) => c.author !== author && !kept.has(key(c)));
      return foreign ? "FOREIGN_COMMENT" : "COMMENTS_ONLY";
    },
    async convert(bytes, extension) {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes)
        throw new AppError("WORKBOOK_TOO_LARGE");
      const ext = extension.toLowerCase();
      if (ext === "csv" || ext === "tsv") {
        const text = Buffer.from(bytes).toString("utf8");
        if (text.includes("\uFFFD") || text.includes("\u0000"))
          throw new AppError("WORKBOOK_UNREADABLE");
        const cells: Record<string, string> = {};
        text
          .replace(/^\uFEFF/, "")
          .split(/\r?\n/)
          .filter((line) => line !== "")
          .forEach((line, row) =>
            line.split(ext === "csv" ? "," : "\t").forEach((value, col) => {
              cells[`${String.fromCharCode(65 + col)}${row + 1}`] = value;
            }),
          );
        return minimalXlsx(cells);
      }
      if (ext === "xlsx") {
        await this.validate(bytes);
        return bytes;
      }
      if ((ext === "xlsb" || ext === "ods") && zipEntryNames(bytes)) return minimalXlsx();
      throw new AppError("WORKBOOK_UNREADABLE");
    },
  };
}
