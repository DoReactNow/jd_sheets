// The workbooks service wired with its real dependencies.
import { logger } from "@/shared/logger";
import { getFileStorage } from "@/shared/storage";
import { systemClock } from "@/shared/time";
import { getWorkbookValidator } from "@/shared/validator";
import { createHistoryService, type HistoryService } from "./workbooks.history";
import { createLeaseService, type LeaseService } from "./workbooks.lease";
import { createLifecycleService, type LifecycleService } from "./workbooks.lifecycle";
import { workbooksRepository } from "./workbooks.repository";
import { createWorkbooksService, type WorkbooksService } from "./workbooks.service";

let instance: WorkbooksService | undefined;
let leaseInstance: LeaseService | undefined;

export function leaseService(): LeaseService {
  leaseInstance ??= createLeaseService({ clock: systemClock });
  return leaseInstance;
}

/** Built on first use, so importing this module needs no environment (next build). */
export function workbooksService(): WorkbooksService {
  instance ??= createWorkbooksService({
    repository: workbooksRepository,
    lease: leaseService(),
    storage: getFileStorage(),
    validator: getWorkbookValidator(),
    clock: systemClock,
    logger,
  });
  return instance;
}

let historyInstance: HistoryService | undefined;
let lifecycleInstance: LifecycleService | undefined;

export function historyService(): HistoryService {
  historyInstance ??= createHistoryService({
    repository: workbooksRepository,
    lease: leaseService(),
    storage: getFileStorage(),
    clock: systemClock,
  });
  return historyInstance;
}

export function lifecycleService(): LifecycleService {
  lifecycleInstance ??= createLifecycleService({
    repository: workbooksRepository,
    storage: getFileStorage(),
    validator: getWorkbookValidator(),
    clock: systemClock,
    logger,
  });
  return lifecycleInstance;
}
