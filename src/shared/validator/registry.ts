// The only file that imports a workbook validator driver (architecture rule 8).
import { getEnv, type Env } from "@/shared/config/env";
import { createCollabValidator } from "./drivers/collab";
import { createFakeValidator } from "./drivers/fake";
import type { WorkbookValidator } from "./workbookValidator";

export function createWorkbookValidator(driver: Env["WORKBOOK_VALIDATOR"]): WorkbookValidator {
  switch (driver) {
    case "collab":
      return createCollabValidator();
    case "fake":
      return createFakeValidator();
    default:
      throw new Error(`Unknown WORKBOOK_VALIDATOR "${String(driver)}"`);
  }
}

let cached: WorkbookValidator | undefined;

export function getWorkbookValidator(): WorkbookValidator {
  cached ??= createWorkbookValidator(getEnv().WORKBOOK_VALIDATOR);
  return cached;
}
