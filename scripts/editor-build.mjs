// Builds the GridCraft editor (Decisions 6 to 8):
//   vendor/gridcraft (our own copy, Decision 55) -> scratch copy -> trunk build -> public/editor/
// Unchanged files keep their timestamps in .build/gridcraft, so rebuilds stay incremental.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pinnedGridcraft, pinnedToolchain, ROOT, rustEnv } from "./lib/toolchain.mjs";

const vendor = path.join(ROOT, "vendor/gridcraft");
const buildRoot = path.join(ROOT, ".build");
const source = path.join(buildRoot, "gridcraft");
const out = path.join(ROOT, "public/editor");

const started = process.hrtime.bigint();
const { tag, commit } = pinnedGridcraft();

// 1. Our GridCraft source (Decision 55: our own copy, edited directly) into a scratch folder.
const scratch = mkdtempSync(path.join(tmpdir(), "jd-gridcraft-"));
try {
  execFileSync("rsync", ["-a", "--exclude", "target", `${vendor}/`, `${scratch}/`]);

  // 2. Sync into .build/gridcraft by content, so unchanged files keep their timestamps.
  mkdirSync(source, { recursive: true });
  execFileSync("rsync", ["-a", "--checksum", "--delete", `${scratch}/`, `${source}/`]);

  // 3. trunk build with the pinned toolchain; relative URLs so it works under /editor/.
  rmSync(out, { recursive: true, force: true });
  const result = spawnSync("trunk", ["build", "--release", "--dist", out, "--public-url", "./"], {
    cwd: path.join(source, "apps/gridcraft-web"),
    stdio: "inherit",
    env: rustEnv({
      RUSTUP_TOOLCHAIN: pinnedToolchain(),
      CARGO_TARGET_DIR: path.join(buildRoot, "target"),
    }),
  });
  if (result.status !== 0) {
    console.error("editor build failed: trunk build did not succeed");
    process.exit(result.status ?? 1);
  }

  // 3b. The product is JD Sheets (Decision 65): the files the browser loads carry no other name.
  //     Contents are unchanged, so trunk's integrity hashes stay valid; only names and the
  //     references in index.html change.
  let page = readFileSync(path.join(out, "index.html"), "utf8");
  for (const file of readdirSync(out)) {
    const renamed = file.replace(/^gridcraft-web-/, "sheets-").replace(/^gridcraft-/, "sheets-");
    if (renamed === file) continue;
    renameSync(path.join(out, file), path.join(out, renamed));
    page = page.split(`./${file}`).join(`./${renamed}`);
  }
  writeFileSync(path.join(out, "index.html"), page);

  // 4. Licences travel with the build; build-info.json says exactly what was built (P0-EDIT-03).
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
      { gridcraft: { tag, commit }, toolchain: pinnedToolchain(), scriptHashes },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `editor built: our GridCraft (based on ${tag}) -> public/editor (${seconds.toFixed(0)} s)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
