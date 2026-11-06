// Background jobs of the collab module (Decision 31).
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";
import { collabService } from "./collab.service";

/** Removes live changes no longer built on the current version, after 7 days (P3-RECOV-03). */
export const pruneOpsJob = defineJob({
  name: "collab.pruneOps",
  payload: z.object({}),
  retry: { limit: 2, delaySeconds: 600, backoff: true },
  async handler(_payload, { logger }) {
    const removed = await collabService.prune();
    logger.info("old live changes pruned", { removed });
  },
});

export const collabJobs: AnyJobDefinition[] = [pruneOpsJob];
export const collabSchedules: JobSchedule[] = [
  { job: pruneOpsJob, cron: "5 3 * * *", payload: {} },
];
