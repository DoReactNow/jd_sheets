// E2E runs a real browser against the BUILT app (`npm run build` and `npm run editor:build` first),
// served with .env.test, plus the real Rust service (release build). Only the critical journeys of
// Decision 24 live in e2e/. Phase 0 has no sign-in, so the app runs with the development principal.
import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.test", override: true, quiet: true });

const baseURL = process.env.APP_URL;
const collabURL = process.env.COLLAB_URL;
if (!baseURL || !collabURL) {
  throw new Error("E2E needs .env.test with APP_URL and COLLAB_URL: copy .env.test.example");
}
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "npm run collab:test-start",
      url: `${collabURL}/health`,
      reuseExistingServer: !isCI,
      timeout: 600_000,
    },
    {
      command: "npm run start:test",
      url: `${baseURL}/api/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: { DEV_PRINCIPAL: "on", WORKBOOK_VALIDATOR: "collab" },
    },
  ],
});
