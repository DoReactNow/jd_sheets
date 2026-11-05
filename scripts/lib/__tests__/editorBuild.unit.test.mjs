// P0-EDIT-01, P0-EDIT-02: patches apply to a copy in order, and a broken one names itself.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatches, listPatches, PatchError, patchUpstream } from "../editorBuild.mjs";

let work;
let source;
let patches;

const patchFor = (from, to) =>
  [
    "Upstream: https://github.com/storytold/gridcraft/pull/1",
    "--- a/hello.txt",
    "+++ b/hello.txt",
    "@@ -1 +1 @@",
    `-${from}`,
    `+${to}`,
    "",
  ].join("\n");

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), "jd-patch-test-"));
  source = path.join(work, "source");
  patches = path.join(work, "patches");
  mkdirSync(source);
  mkdirSync(patches);
  writeFileSync(path.join(source, "hello.txt"), "one\n");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("editor build patches", () => {
  it("lists only NNNN-name.patch files, in number order", () => {
    writeFileSync(path.join(patches, "0002-b.patch"), "");
    writeFileSync(path.join(patches, "0001-a.patch"), "");
    writeFileSync(path.join(patches, "README.md"), "");
    writeFileSync(path.join(patches, "notes.patch"), "");
    expect(listPatches(patches)).toEqual(["0001-a.patch", "0002-b.patch"]);
  });

  it("applies patches in order to the copy", () => {
    writeFileSync(path.join(patches, "0001-first.patch"), patchFor("one", "two"));
    writeFileSync(path.join(patches, "0002-second.patch"), patchFor("two", "three"));
    expect(applyPatches(source, patches)).toEqual(["0001-first.patch", "0002-second.patch"]);
    expect(readFileSync(path.join(source, "hello.txt"), "utf8")).toBe("three\n");
  });

  it("fails on a patch that does not apply, naming it, and changes nothing", () => {
    writeFileSync(path.join(patches, "0001-broken.patch"), patchFor("not-there", "x"));
    expect(() => applyPatches(source, patches)).toThrow(PatchError);
    expect(() => applyPatches(source, patches)).toThrow(/0001-broken\.patch/);
    expect(readFileSync(path.join(source, "hello.txt"), "utf8")).toBe("one\n");
  });

  it("reads the upstream pull request from the header", () => {
    expect(patchUpstream("p", patchFor("a", "b"))).toBe(
      "https://github.com/storytold/gridcraft/pull/1",
    );
    expect(patchUpstream("p", "--- a/x")).toBeNull();
  });
});
