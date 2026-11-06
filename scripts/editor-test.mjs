// Runs the tests of our own GridCraft changes (Decision 55) natively, with the pinned toolchain:
// the web app's access modes (apps/gridcraft-web/src/access). Usage: npm run editor:test
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pinnedToolchain, ROOT, rustEnv } from "./lib/toolchain.mjs";

const result = spawnSync("cargo", ["test", "-p", "gridcraft-web"], {
  cwd: path.join(ROOT, "vendor/gridcraft"),
  stdio: "inherit",
  env: rustEnv({
    RUSTUP_TOOLCHAIN: pinnedToolchain(),
    CARGO_TARGET_DIR: path.join(ROOT, ".build/target-native"),
  }),
});
process.exit(result.status ?? 1);
