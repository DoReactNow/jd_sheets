// Fails when vendor/gridcraft differs from the pinned commit (Decision 6, P0-ARCH-03):
// a different checkout, or any modified, added or deleted file inside it.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT, pinnedGridcraft } from "./lib/toolchain.mjs";

const vendor = path.join(ROOT, "vendor/gridcraft");
const git = (...args) => execFileSync("git", ["-C", vendor, ...args], { encoding: "utf8" }).trim();

const problems = [];
const { tag, commit } = pinnedGridcraft();
let head = "";
try {
  head = git("rev-parse", "HEAD");
} catch {
  problems.push("vendor/gridcraft is missing: run `git submodule update --init --recursive`");
}
if (head && head !== commit) {
  problems.push(
    `vendor/gridcraft is at ${head}, but vendor/GRIDCRAFT_VERSION pins ${tag} (${commit})`,
  );
}
if (head) {
  const status = git("status", "--porcelain", "--untracked-files=all");
  if (status) {
    problems.push(
      "vendor/gridcraft has local changes. Never edit GridCraft; put changes in patches/gridcraft/ (Decision 8):\n" +
        status
          .split("\n")
          .slice(0, 20)
          .map((line) => `    ${line}`)
          .join("\n"),
    );
  }
}

if (problems.length > 0) {
  console.error(`vendor check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`vendor check passed: GridCraft ${tag} (${commit.slice(0, 12)}) is untouched`);
