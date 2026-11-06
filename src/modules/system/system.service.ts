// System rules: health, diagnostics and the worker heartbeat. No HTTP types.
import type { Logger } from "@/shared/logger";
import { toIsoInstant, type Clock } from "@/shared/time";
import type { SystemRepository } from "./system.repository";
import type { Diagnostics, EditorBuild, Health } from "./system.schemas";
import { WORKER_DOWN_AFTER_SECONDS } from "./system.types";

export interface SystemServiceDeps {
  repository: SystemRepository;
  clock: Clock;
  version: string;
  logger: Pick<Logger, "warn">;
  /** True when the Rust collab service answers. */
  pingCollab: () => Promise<boolean>;
  /** What the built editor is (from public/editor/build-info.json), or null when not built. */
  editorBuild: () => Promise<EditorBuild | null>;
}

export function createSystemService(deps: SystemServiceDeps) {
  const { repository, clock, version, logger } = deps;

  async function getHealth(): Promise<Health> {
    let database: Health["database"] = "up";
    try {
      await repository.pingDatabase();
    } catch (error) {
      database = "down";
      logger.warn("health check: database did not answer", { err: error });
    }
    return {
      status: database === "up" ? "ok" : "degraded",
      database,
      version,
      time: toIsoInstant(clock.now()),
    };
  }

  async function getWorkerStatus(): Promise<Diagnostics["worker"]> {
    const latest = await repository.latestHeartbeat();
    if (!latest) return { state: "down", lastBeatAt: null };
    const ageMs = clock.now().getTime() - latest.lastBeatAt.getTime();
    return {
      state: ageMs <= WORKER_DOWN_AFTER_SECONDS * 1000 ? "up" : "down",
      lastBeatAt: toIsoInstant(latest.lastBeatAt),
    };
  }

  return {
    getHealth,

    async getDiagnostics(): Promise<Diagnostics> {
      const health = await getHealth();
      const [collabUp, worker, editor] = await Promise.all([
        deps.pingCollab(),
        health.database === "up"
          ? getWorkerStatus()
          : Promise.resolve({ state: "down", lastBeatAt: null } as const),
        deps.editorBuild(),
      ]);
      return { ...health, collab: collabUp ? "up" : "down", worker, editor };
    },

    /** Called by the worker every few seconds (Decision 31). */
    async recordHeartbeat({ workerId, startedAt }: { workerId: string; startedAt: Date }) {
      await repository.upsertHeartbeat({ workerId, version, startedAt, lastBeatAt: clock.now() });
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
