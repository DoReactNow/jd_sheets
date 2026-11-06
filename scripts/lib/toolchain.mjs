// Shared helpers for scripts that run Rust tools. Homebrew's rustup keeps its proxies outside
// ~/.cargo/bin, so both are added to PATH (local_setup.md Section 1).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The Rust toolchain every build uses (services/collab/rust-toolchain.toml). */
export function pinnedToolchain() {
  const text = readFileSync(path.join(ROOT, "services/collab/rust-toolchain.toml"), "utf8");
  const match = /channel\s*=\s*"([^"]+)"/.exec(text);
  if (!match) throw new Error("services/collab/rust-toolchain.toml has no channel");
  return match[1];
}

/** The trunk version the editor build expects (installed by npm run setup:rust). */
export const TRUNK_VERSION = "0.22.1";

export function rustEnv(extra = {}) {
  const extraPaths = ["/opt/homebrew/opt/rustup/bin", path.join(homedir(), ".cargo", "bin")];
  return {
    ...process.env,
    PATH: [...extraPaths, process.env.PATH ?? ""].join(path.delimiter),
    ...extra,
  };
}

/** Reads vendor/GRIDCRAFT_VERSION: { tag, commit }. */
export function pinnedGridcraft() {
  const text = readFileSync(path.join(ROOT, "vendor/GRIDCRAFT_VERSION"), "utf8");
  const values = Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => line.split("=").map((part) => part.trim())),
  );
  if (!values.tag || !values.commit)
    throw new Error("vendor/GRIDCRAFT_VERSION needs tag= and commit=");
  return { tag: values.tag, commit: values.commit };
}
