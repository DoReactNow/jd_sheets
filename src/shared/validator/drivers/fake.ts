// The "fake" validator for unit and integration tests: checks the size and that the bytes are a
// ZIP holding the parts every XLSX has. Only the registry imports this file.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import type { WorkbookValidator } from "../workbookValidator";
import { minimalXlsx, zipEntryNames } from "../zip";

const REQUIRED_PARTS = ["[Content_Types].xml", "xl/workbook.xml"];

export function createFakeValidator(): WorkbookValidator {
  return {
    driver: "fake",
    async validate(bytes) {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes) throw new AppError("WORKBOOK_TOO_LARGE");
      const names = zipEntryNames(bytes);
      if (!names || !REQUIRED_PARTS.every((part) => names.includes(part))) {
        throw new AppError("WORKBOOK_UNREADABLE");
      }
      return { sheets: ["Sheet1"] };
    },
    async blank() {
      return minimalXlsx();
    },
  };
}
