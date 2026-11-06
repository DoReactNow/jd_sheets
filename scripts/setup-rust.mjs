// Installs the pinned Rust toolchain (with rustfmt, clippy and the WebAssembly target) and the
// pinned trunk (local_setup.md Section 1). Safe to run again.
import { execFileSync, spawnSync } from "node:child_process";
import { pinnedToolchain, rustEnv, TRUNK_VERSION } from "./lib/toolchain.mjs";

const env = rustEnv();
const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const toolchain = pinnedToolchain();
run("rustup", [
  "toolchain",
  "install",
  toolchain,
  "--profile",
  "minimal",
  "--component",
  "rustfmt,clippy",
  "--target",
  "wasm32-unknown-unknown",
]);

let installed = "";
try {
  installed = execFileSync("trunk", ["--version"], { env, encoding: "utf8" }).trim();
} catch {
  installed = "";
}
if (installed === `trunk ${TRUNK_VERSION}`) {
  console.log(`${installed} already installed`);
} else {
  // trunk is a build tool, so it may be built with the newest stable compiler (it needs a newer
  // one than GridCraft's minimum); the editor itself is still compiled with the pinned toolchain.
  run("rustup", ["toolchain", "install", "stable", "--profile", "minimal"]);
  run("cargo", ["+stable", "install", "trunk", "--locked", "--version", TRUNK_VERSION]);
}
let bindgen = "";
try {
  bindgen = execFileSync("wasm-bindgen", ["--version"], { env, encoding: "utf8" }).trim();
} catch {
  bindgen = "";
}
if (bindgen === "wasm-bindgen 0.2.129") {
  console.log(`${bindgen} already installed`);
} else {
  run("cargo", ["+stable", "install", "wasm-bindgen-cli", "--locked", "--version", "0.2.129"]);
}
console.log("Rust setup complete. Make sure ~/.cargo/bin is on your PATH.");
