// Public API of the system module: the only entry point for other modules and the worker.
import { systemService } from "./system.instance";

export type { Diagnostics, EditorBuild, Health } from "./system.schemas";
export { HEARTBEAT_INTERVAL_SECONDS, WORKER_DOWN_AFTER_SECONDS } from "./system.types";
export {
  getTestProbeRuns,
  resetTestProbeRuns,
  systemJobs,
  systemSchedules,
  systemTestJobs,
} from "./system.jobs";

export const recordWorkerHeartbeat = systemService.recordHeartbeat;
