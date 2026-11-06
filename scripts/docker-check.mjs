// Checks the full Docker stack (W-015):
//   P0-DOCKER-02  runtime images run as non-root and contain no compilers
//   P0-DOCKER-01  the full stack starts, and a workbook can be created and saved through Caddy
// Usage: node scripts/docker-check.mjs   (builds the images first if needed; stops the stack after)
import { execFileSync, spawnSync } from "node:child_process";

const COMPOSE = ["compose", "-f", "docker/docker-compose.local.yml", "--profile", "full"];
const BASE = "http://127.0.0.1:47324";
const IMAGES = ["jdsheets-app", "jdsheets-worker", "jdsheets-collab", "jdsheets-migrator"];
const problems = [];

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

// --- P0-DOCKER-02 ---------------------------------------------------------------------------
for (const image of IMAGES) {
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "id -u; for c in cc gcc g++ rustc cargo make; do command -v $c; done; true",
    ],
    { encoding: "utf8" },
  );
  const lines = result.stdout.trim().split("\n");
  if (result.status !== 0)
    problems.push(`${image}: could not start a shell (${result.stderr.trim()})`);
  else {
    if (lines[0] === "0") problems.push(`${image}: runs as root`);
    const compilers = lines.slice(1).filter(Boolean);
    if (compilers.length > 0) problems.push(`${image}: contains ${compilers.join(", ")}`);
  }
}

// --- P0-DOCKER-01 ---------------------------------------------------------------------------
async function smoke() {
  docker([...COMPOSE, "up", "-d", "--wait"], { stdio: "inherit" });
  const health = await fetch(`${BASE}/api/health`);
  if (health.status !== 200) problems.push(`health through Caddy answered ${health.status}`);

  const created = await fetch(`${BASE}/api/workbooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Docker smoke test" }),
  });
  if (created.status !== 201) return problems.push(`create answered ${created.status}`);
  const { data: workbook } = await created.json();

  const content = await fetch(`${BASE}/api/workbooks/${workbook.id}/content`);
  const bytes = new Uint8Array(await content.arrayBuffer());
  const saved = await fetch(`${BASE}/api/workbooks/${workbook.id}/content`, {
    method: "PUT",
    headers: { "if-match": content.headers.get("etag") ?? "" },
    body: bytes,
  });
  if (saved.status !== 200) problems.push(`save through Caddy answered ${saved.status}`);

  const editor = await fetch(`${BASE}/editor/index.html`);
  if (editor.status !== 200 || editor.headers.get("x-frame-options") !== "SAMEORIGIN") {
    problems.push(`editor files: ${editor.status} ${editor.headers.get("x-frame-options")}`);
  }
  const internal = await fetch(`${BASE}/api/internal/anything`);
  if (internal.status !== 404)
    problems.push(`internal path reachable through Caddy (${internal.status})`);
}

try {
  await smoke();
} catch (error) {
  problems.push(`smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // Stop only the full-stack services; the everyday database keeps running.
  spawnSync("docker", [...COMPOSE, "stop", "caddy", "app", "worker", "collab", "migrator"], {
    stdio: "inherit",
  });
}

if (problems.length > 0) {
  console.error(`docker check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  "docker check passed: non-root images without compilers; create and save work through Caddy",
);
