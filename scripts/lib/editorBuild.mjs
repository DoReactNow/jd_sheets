// The steps of the editor build (Decision 8), kept as functions so they can be tested.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Patch files in apply order: patches/gridcraft/NNNN-name.patch. */
export function listPatches(patchDir) {
  if (!existsSync(patchDir)) return [];
  return readdirSync(patchDir)
    .filter((name) => /^\d{4}-[a-z0-9-]+\.patch$/.test(name))
    .sort();
}

export class PatchError extends Error {
  constructor(patch, detail) {
    super(`patch ${patch} does not apply to the pinned GridCraft source:\n${detail}`);
    this.name = "PatchError";
    this.patch = patch;
  }
}

/** Applies every patch to `sourceDir` (a plain copy, not the submodule). Checks each first. */
export function applyPatches(sourceDir, patchDir) {
  const applied = [];
  for (const patch of listPatches(patchDir)) {
    const file = path.join(patchDir, patch);
    const check = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", file], {
      cwd: sourceDir,
      encoding: "utf8",
    });
    if (check.status !== 0) throw new PatchError(patch, (check.stderr || check.stdout).trim());
    execFileSync("git", ["apply", "--whitespace=nowarn", file], { cwd: sourceDir });
    applied.push(patch);
  }
  return applied;
}

/** The upstream pull request a patch names in its header line `Upstream: <url>`. */
export function patchUpstream(patchFile, text) {
  const match = /^Upstream:\s*(\S+)/m.exec(text);
  return match ? match[1] : null;
}
