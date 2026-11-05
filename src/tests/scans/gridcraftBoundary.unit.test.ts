// P0-ARCH-04 (TypeScript side, Decision 6 rule 9): only src/modules/editor/bridge/ knows GridCraft's
// message names. The prefix itself lives in appConfig.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const ALLOWED = [/^modules\/editor\/bridge\//, /^shared\/config\/appConfig\.ts$/, /^generated\//];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("GridCraft boundary", () => {
  it("finds GridCraft message names only in the editor bridge", () => {
    const offenders = files(SRC)
      .map((file) => relative(SRC, file).split(sep).join("/"))
      .filter((rel) => !ALLOWED.some((pattern) => pattern.test(rel)))
      .filter((rel) => /gridcraft:[a-z]/i.test(readFileSync(join(SRC, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
