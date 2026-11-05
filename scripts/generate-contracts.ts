// `npm run contracts:generate`: writes the fixtures shared by the app and the Rust service
// (Decision 10, Decision 24). Contract tests on both sides read them; the TypeScript contract test
// also regenerates them in memory and fails if the committed files are stale.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  appConfigContract,
  buildTokenFixtures,
} from "../src/modules/collab/contractFixtures";
import { CLIENT_IP_CASES, RUST_ERROR_CODES } from "../src/modules/collab/contractCases";

const root = path.resolve(__dirname, "..", "contracts");
const write = (file: string, value: unknown) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote contracts/${file}`);
};

async function main() {
  write("collab-token/cases.json", await buildTokenFixtures());
  write("app-config.json", appConfigContract());
  write("error-codes.json", RUST_ERROR_CODES);
  write("client-ip/cases.json", CLIENT_IP_CASES);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
