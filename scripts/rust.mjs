// Runs cargo for the collab service with the pinned toolchain (services/collab/rust-toolchain.toml).
// Usage: node scripts/rust.mjs <check|build|test|run|run-release> [env file]
//   check        rustfmt --check and clippy with warnings as errors
//   build        release build
//   test         tests, with the env file loaded (tests that touch the database need .env.test)
//   run          the service with the env file loaded (development)
//   run-release  the release build with the env file loaded (E2E and contract tests)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ROOT, rustEnv } from "./lib/toolchain.mjs";

const [command, envFile] = process.argv.slice(2);
const cwd = path.join(ROOT, "services/collab");

function loadEnvFile() {
  if (!envFile) return {};
  const file = path.resolve(ROOT, envFile);
  if (!existsSync(file)) {
    console.error(`[rust] ${envFile} not found; copy the matching *.example file first`);
    process.exit(1);
  }
  return dotenv.config({ path: file, processEnv: {}, quiet: true }).parsed ?? {};
}

function cargo(args, extraEnv = {}) {
  console.log(`> cargo ${args.join(" ")}`);
  const result = spawnSync("cargo", args, { cwd, stdio: "inherit", env: rustEnv(extraEnv) });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

switch (command) {
  case "check":
    cargo(["fmt", "--check"]);
    cargo(["clippy", "--all-targets", "--locked", "--", "-D", "warnings"]);
    break;
  case "build":
    cargo(["build", "--release", "--locked"]);
    break;
  case "test":
    cargo(["test", "--locked"], loadEnvFile());
    break;
  case "run":
    cargo(["run", "--locked"], loadEnvFile());
    break;
  case "run-release":
    cargo(["run", "--release", "--locked"], loadEnvFile());
    break;
  default:
    console.error("usage: node scripts/rust.mjs <check|build|test|run|run-release> [env file]");
    process.exit(1);
}
