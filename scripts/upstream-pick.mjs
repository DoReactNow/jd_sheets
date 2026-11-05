// Prints `tag=<tag>` and `newer=<true|false>` (GitHub Actions outputs): the newest GridCraft release
// tag (or the one given), and whether it is newer than the pinned one.
import { execFileSync } from "node:child_process";
import { pinnedGridcraft } from "./lib/toolchain.mjs";

const requested = (process.argv[2] ?? "").trim();
const tags = execFileSync(
  "git",
  ["ls-remote", "--tags", "--refs", "https://github.com/storytold/gridcraft"],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .map((line) => line.split("refs/tags/")[1])
  .filter((tag) => tag && /^v\d+\.\d+\.\d+$/.test(tag));

const parse = (tag) => tag.slice(1).split(".").map(Number);
const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const newest = requested || tags.sort(compare).at(-1);
if (!newest || (requested && !tags.includes(requested))) {
  console.error(`no such GridCraft release: ${requested || "(none found)"}`);
  process.exit(1);
}
const pinned = pinnedGridcraft().tag;
console.log(`tag=${newest}`);
console.log(`newer=${requested ? newest !== pinned : compare(newest, pinned) > 0}`);
