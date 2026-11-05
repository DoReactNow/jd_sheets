// The workbooks service wired with its real dependencies.
import { logger } from "@/shared/logger";
import { getFileStorage } from "@/shared/storage";
import { systemClock } from "@/shared/time";
import { getWorkbookValidator } from "@/shared/validator";
import { workbooksRepository } from "./workbooks.repository";
import { createWorkbooksService, type WorkbooksService } from "./workbooks.service";

let instance: WorkbooksService | undefined;

/** Built on first use, so importing this module needs no environment (next build). */
export function workbooksService(): WorkbooksService {
  instance ??= createWorkbooksService({
    repository: workbooksRepository,
    storage: getFileStorage(),
    validator: getWorkbookValidator(),
    clock: systemClock,
    logger,
  });
  return instance;
}
