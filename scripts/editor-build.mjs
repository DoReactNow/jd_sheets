// Builds the GridCraft editor (Decisions 6 to 8):
//   vendor/gridcraft (never touched) -> clean copy -> patches -> trunk build -> public/editor/
// Unchanged files keep their timestamps in .build/gridcraft, so rebuilds stay incremental.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPatches, PatchError } from "./lib/editorBuild.mjs";
import { pinnedGridcraft, pinnedToolchain, ROOT, rustEnv } from "./lib/toolchain.mjs";

const vendor = path.join(ROOT, "vendor/gridcraft");
const buildRoot = path.join(ROOT, ".build");
const source = path.join(buildRoot, "gridcraft");
const out = path.join(ROOT, "public/editor");
const patchDir = path.join(ROOT, "patches/gridcraft");

const started = process.hrtime.bigint();
const { tag, commit } = pinnedGridcraft();

// 1. The vendored source must be exactly the pinned commit, untouched.
execFileSync("node", [path.join(ROOT, "scripts/check-vendor-clean.mjs")], { stdio: "inherit" });

// 2. Committed files of the pinned commit, into a scratch folder, then patched.
const scratch = mkdtempSync(path.join(tmpdir(), "jd-gridcraft-"));
try {
  execFileSync("sh", ["-c", `git -C "${vendor}" archive --format=tar HEAD | tar -x -C "${scratch}"`]);
  let patches;
  try {
    patches = applyPatches(scratch, patchDir);
  } catch (error) {
    if (error instanceof PatchError) {
      console.error(`editor build failed: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  // 3. Sync into .build/gridcraft by content, so unchanged files keep their timestamps.
  mkdirSync(source, { recursive: true });
  execFileSync("rsync", ["-a", "--checksum", "--delete", `${scratch}/`, `${source}/`]);

  // 4. trunk build with the pinned toolchain; relative URLs so it works under /editor/.
  rmSync(out, { recursive: true, force: true });
  const result = spawnSync(
    "trunk",
    ["build", "--release", "--dist", out, "--public-url", "./"],
    {
      cwd: path.join(source, "apps/gridcraft-web"),
      stdio: "inherit",
      env: rustEnv({
        RUSTUP_TOOLCHAIN: pinnedToolchain(),
        CARGO_TARGET_DIR: path.join(buildRoot, "target"),
      }),
    },
  );
  if (result.status !== 0) {
    console.error("editor build failed: trunk build did not succeed");
    process.exit(result.status ?? 1);
  }

  // 5. Licences travel with the build; build-info.json says exactly what was built (P0-EDIT-03).
  for (const file of ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE"]) {
    const from = path.join(scratch, file);
    if (existsSync(from)) cpSync(from, path.join(out, file));
  }
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  // The editor's content security policy allows its inline loader script by hash (next.config.ts).
  const html = readFileSync(path.join(out, "index.html"), "utf8");
  const scriptHashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((body) => body.trim() !== "")
    .map((body) => `sha384-${createHash("sha384").update(body).digest("base64")}`);
  writeFileSync(
    path.join(out, "build-info.json"),
    JSON.stringify(
      { gridcraft: { tag, commit }, patches, toolchain: pinnedToolchain(), scriptHashes },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `editor built: GridCraft ${tag} with ${patches.length} patch(es) -> public/editor (${seconds.toFixed(0)} s)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
