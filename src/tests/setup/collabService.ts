// Starts the real Rust collab service (release build) on the test port from .env.test, for the
// contract and E2E tests. Builds it first if needed. Stops it afterwards.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { getEnv } from "@/shared/config/env";

const ROOT = process.cwd();
const BINARY = path.join(ROOT, "services/collab/target/release/jd-collab");

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", url));
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The collab service did not answer on ${url} in time`);
}

export async function startCollabService(): Promise<() => Promise<void>> {
  const env = getEnv();
  if (!existsSync(BINARY)) {
    const build = spawnSync("node", ["scripts/rust.mjs", "build"], { stdio: "inherit", cwd: ROOT });
    if (build.status !== 0) throw new Error("building the collab service failed");
  }
  let child: ChildProcess | null = spawn(BINARY, [], {
    cwd: ROOT,
    env: { ...process.env, COLLAB_LOG: "warn" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", () => {
    child = null;
  });
  await waitForHealth(env.COLLAB_URL, 15_000);
  return async () => {
    if (!child) return;
    const exited = new Promise((resolve) => child?.once("exit", resolve));
    child.kill("SIGINT");
    await exited;
  };
}
