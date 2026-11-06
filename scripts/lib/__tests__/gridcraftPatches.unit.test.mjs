// P2-MODE-01: every committed GridCraft patch applies to the pinned tag and names its upstream
// pull request (or, until the owner opens it, says "pending" next to the text to open it with,
// Decision 53). Phase 4 acceptance requires real links.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPatches, listPatches, patchUpstream } from "../editorBuild.mjs";
import { ROOT } from "../toolchain.mjs";

const patchDir = path.join(ROOT, "patches/gridcraft");
const vendor = path.join(ROOT, "vendor/gridcraft");
let copy;

beforeAll(() => {
  copy = mkdtempSync(path.join(tmpdir(), "jd-gridcraft-check-"));
  execFileSync("sh", ["-c", `git -C "${vendor}" archive --format=tar HEAD | tar -x -C "${copy}"`]);
});
afterAll(() => rmSync(copy, { recursive: true, force: true }));

describe("GridCraft patches", () => {
  const patches = listPatches(patchDir);

  it("include patch 0001 (access mode)", () => {
    expect(patches).toContain("0001-access-mode.patch");
  });

  it.each(patches)("%s names its upstream pull request", (patch) => {
    const text = readFileSync(path.join(patchDir, patch), "utf8");
    expect(text.split("\n")[0]).toMatch(/^Upstream: /);
    const upstream = patchUpstream(patch, text);
    if (upstream === "pending") {
      expect(existsSync(path.join(patchDir, patch.replace(/\.patch$/, ".upstream.md")))).toBe(true);
    } else {
      expect(upstream).toMatch(/^https:\/\/github\.com\/storytold\/gridcraft\/pull\/\d+$/);
    }
  });

  it("all apply, in order, to the pinned source", () => {
    expect(applyPatches(copy, patchDir)).toEqual(patches);
  }, 60_000);

  it("change only the web app (Decision 8)", () => {
    for (const patch of patches) {
      const text = readFileSync(path.join(patchDir, patch), "utf8");
      const files = [...text.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
      for (const file of files) expect(file, `${patch}: ${file}`).toMatch(/^apps\/gridcraft-web\//);
    }
  });
});
