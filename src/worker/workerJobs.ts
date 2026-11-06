// The jobs this worker runs: every module's exported jobs, plus test-only jobs when APP_ENV=test.
import { collabJobs, collabSchedules } from "@/modules/collab";
import { identityJobs, identitySchedules } from "@/modules/identity";
import { systemJobs, systemSchedules, systemTestJobs } from "@/modules/system";
import { workbookJobs, workbookSchedules } from "@/modules/workbooks";
import type { Env } from "@/shared/config/env";
import { assembleJobs } from "./jobRegistry";

export function collectWorkerJobs(appEnv: Env["APP_ENV"]) {
  return assembleJobs({
    collab: collabJobs,
    identity: identityJobs,
    system: [...systemJobs, ...(appEnv === "test" ? systemTestJobs : [])],
    workbooks: workbookJobs,
  });
}

export function collectWorkerSchedules() {
  return [...collabSchedules, ...identitySchedules, ...systemSchedules, ...workbookSchedules];
}
