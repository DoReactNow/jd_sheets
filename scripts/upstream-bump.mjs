// Moves vendor/gridcraft to a release tag and records it in vendor/GRIDCRAFT_VERSION.
// Used by the weekly upstream job; also fine to run by hand: node scripts/upstream-bump.mjs v0.17.0
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/toolchain.mjs";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error("usage: node scripts/upstream-bump.mjs vX.Y.Z");
  process.exit(1);
}
const vendor = path.join(ROOT, "vendor/gridcraft");
const git = (...args) => execFileSync("git", ["-C", vendor, ...args], { encoding: "utf8" }).trim();
git("fetch", "--tags", "--quiet", "origin");
git("checkout", "--quiet", tag);
const commit = git("rev-parse", "HEAD");
writeFileSync(path.join(ROOT, "vendor/GRIDCRAFT_VERSION"), `tag=${tag}\ncommit=${commit}\n`);
console.log(
  `GridCraft is now ${tag} (${commit.slice(0, 12)}); run npm run editor:build and the checks`,
);
