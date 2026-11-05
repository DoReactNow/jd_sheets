// Background jobs of the system module. The test-only probe job proves the queue, retries and
// delayed jobs (P0-JOB-01..03); the worker registers it only when APP_ENV=test.
import { z } from "zod";
import { defineJob, type AnyJobDefinition, type JobSchedule } from "@/shared/jobs";

export const systemJobs: AnyJobDefinition[] = [];
export const systemSchedules: JobSchedule[] = [];

const probeRuns = new Map<string, number>();

export const testProbeJob = defineJob({
  name: "system.testProbe",
  payload: z.object({ key: z.string().min(1), fail: z.boolean().optional() }),
  retry: { limit: 2, delaySeconds: 10, backoff: false },
  async handler({ key, fail }) {
    probeRuns.set(key, (probeRuns.get(key) ?? 0) + 1);
    if (fail) throw new Error("test probe asked to fail");
  },
});

export const systemTestJobs = [testProbeJob];

export const getTestProbeRuns = (key: string) => probeRuns.get(key) ?? 0;
export const resetTestProbeRuns = () => probeRuns.clear();
