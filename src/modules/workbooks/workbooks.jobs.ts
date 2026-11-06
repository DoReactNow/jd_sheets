// Background jobs of the workbooks module (Decision 31).
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { lifecycleService, workbooksService } from "./workbooks.instance";

/** Removes stored files of failed or refused saves (P0-JOB-04). Idempotent. */
export const purgeOrphanFilesJob = defineJob({
  name: "workbooks.purgeOrphanFiles",
  payload: z.object({}),
  retry: { limit: 2, delaySeconds: 300, backoff: true },
  async handler(_payload, { logger }) {
    const deleted = await workbooksService().purgeOrphanFiles();
    logger.info("orphan file cleanup finished", { deleted });
  },
});

/** Thins out old versions (P2-VER-06, -07). Idempotent; the run date is its key. */
export const pruneVersionsJob = defineJob({
  name: "workbooks.pruneVersions",
  payload: z.object({}),
  retry: { limit: 2, delaySeconds: 600, backoff: true },
  async handler(_payload, { logger }) {
    const removed = await lifecycleService().pruneVersions();
    logger.info("version pruning finished", { removed });
  },
});

/** Deletes workbooks trashed more than 30 days ago (P2-TRASH-03). Idempotent. */
export const purgeTrashJob = defineJob({
  name: "workbooks.purgeTrash",
  payload: z.object({}),
  retry: { limit: 2, delaySeconds: 600, backoff: true },
  async handler(_payload, { logger }) {
    const purged = await lifecycleService().purgeTrash();
    logger.info("trash purge finished", { purged });
  },
});

export const workbookJobs: AnyJobDefinition[] = [
  purgeOrphanFilesJob,
  pruneVersionsJob,
  purgeTrashJob,
];
export const workbookSchedules: JobSchedule[] = [
  // Sundays at 03:30 business time.
  { job: purgeOrphanFilesJob, cron: "30 3 * * 0", payload: {} },
  // Every night, business time.
  { job: pruneVersionsJob, cron: "15 2 * * *", payload: {} },
  { job: purgeTrashJob, cron: "45 2 * * *", payload: {} },
];
