// Starts (or stops) the servers E2E needs, detached, and waits until they answer:
//   the Rust collab service (release), the worker, and the built app with the network rules on.
// Usage: node scripts/e2e-servers.mjs start | stop
// Playwright reuses them (reuseExistingServer), so starting is predictable locally and in CI.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "./lib/toolchain.mjs";

const env = dotenv.config({ path: path.join(ROOT, ".env.test"), processEnv: {}, quiet: true }).parsed ?? {};
const dir = path.join(ROOT, "test-results", "e2e-servers");
const pidFile = path.join(dir, "pids.json");

const SERVERS = [
  { name: "collab", command: ["npm", "run", "collab:test-start"], health: `${env.COLLAB_URL}/health`, extra: {} },
  { name: "worker", command: ["npm", "run", "worker:test-start"], health: null, extra: { LOG_LEVEL: "info" } },
  {
    name: "app",
    command: ["npm", "run", "start:test"],
    health: `${env.APP_URL}/api/health`,
    extra: { NETWORK_ENFORCEMENT: "on", WORKBOOK_VALIDATOR: "collab" },
  },
];

async function up(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function waitFor(name, url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await up(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${name} did not answer on ${url} within ${seconds} s (see ${dir}/${name}.log)`);
}

async function start() {
  mkdirSync(dir, { recursive: true });
  const pids = {};
  for (const server of SERVERS) {
    if (server.health && (await up(server.health))) {
      console.log(`[e2e] ${server.name} already running`);
      continue;
    }
    const log = openSync(path.join(dir, `${server.name}.log`), "w");
    const child = spawn(server.command[0], server.command.slice(1), {
      cwd: ROOT,
      env: { ...process.env, ...server.extra },
      stdio: ["ignore", log, log],
      detached: true,
    });
    child.unref();
    pids[server.name] = child.pid;
    console.log(`[e2e] started ${server.name}`);
    if (server.health) await waitFor(server.name, server.health, server.name === "collab" ? 600 : 60);
  }
  writeFileSync(pidFile, JSON.stringify(pids));
  console.log("[e2e] servers ready");
}

function stop() {
  if (!existsSync(pidFile)) return;
  for (const [name, pid] of Object.entries(JSON.parse(readFileSync(pidFile, "utf8")))) {
    try {
      process.kill(-pid, "SIGTERM"); // the whole process group (npm and its child)
      console.log(`[e2e] stopped ${name}`);
    } catch {
      // already gone
    }
  }
  rmSync(pidFile, { force: true });
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "stop") stop();
else {
  console.error("usage: node scripts/e2e-servers.mjs start | stop");
  process.exit(1);
}
