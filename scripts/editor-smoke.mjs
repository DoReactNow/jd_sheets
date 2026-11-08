// Opens the editor from the production images (behind Traefik, after scripts/stack-check.sh) in a
// real browser and fails unless it starts: the loading text goes away and nothing throws. The
// unit and E2E tests use the editor built on the developer's machine; this checks the one in the
// image (a wasm-opt mismatch once broke only that build).
// Usage: node scripts/editor-smoke.mjs   (expects the stack check's Traefik on 127.0.0.1:8443)
import { chromium } from "@playwright/test";

const DOMAIN = "sheets.ci.test";
// EDITOR_SMOKE_URL checks another address instead (for example the live site).
const url = process.env.EDITOR_SMOKE_URL ?? `https://${DOMAIN}/editor/index.html`;
const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${DOMAIN}:443 127.0.0.1:8443`],
});
const page = await browser.newPage({ ignoreHTTPSErrors: true });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
let started = false;
try {
  await page.goto(url);
  await page.locator("#sheets_canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#sheets_loading").waitFor({ state: "hidden", timeout: 90_000 });
  started = true;
} catch (error) {
  errors.push(`did not start: ${String(error).split("\n")[0]}`);
}
await browser.close();
if (!started || errors.length > 0) {
  console.error("Editor smoke check FAILED:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log("Editor smoke check passed: the editor in the image starts in a real browser");
