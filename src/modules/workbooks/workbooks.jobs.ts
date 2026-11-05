// Background jobs of the workbooks module (Decision 31).
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { workbooksService } from "./workbooks.instance";

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

export const workbookJobs: AnyJobDefinition[] = [purgeOrphanFilesJob];
export const workbookSchedules: JobSchedule[] = [
  // Sundays at 03:30 business time.
  { job: purgeOrphanFilesJob, cron: "30 3 * * 0", payload: {} },
];
