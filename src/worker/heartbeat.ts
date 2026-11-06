// Writes the worker heartbeat now and then every `intervalMs` (shown on the diagnostics page).
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordWorkerHeartbeat } from "@/modules/system";
import { logger } from "@/shared/logger";
import { systemClock } from "@/shared/time";

export const WORKER_ALIVE_FILE = join(tmpdir(), "jdsheets-worker-alive");

export async function startHeartbeat({
  workerId,
  intervalMs,
}: {
  workerId: string;
  intervalMs: number;
}) {
  const startedAt = systemClock.now();
  // The file is what the container health check looks at (docker/Dockerfile, worker stage).
  const beat = async () => {
    await recordWorkerHeartbeat({ workerId, startedAt });
    await writeFile(WORKER_ALIVE_FILE, systemClock.now().toISOString());
  };
  await beat();
  const timer = setInterval(() => {
    beat().catch((error: unknown) =>
      logger.error("worker heartbeat failed", { err: error, workerId }),
    );
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
