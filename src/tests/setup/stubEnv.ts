// A complete, valid environment for unit tests that load env-dependent modules (vi.stubEnv).
import { vi } from "vitest";

export type StubAppEnv = "development" | "test" | "production";

export function stubEnvFor(appEnv: StubAppEnv, overrides: Record<string, string> = {}): void {
  const production = appEnv === "production";
  const values: Record<string, string> = {
    APP_ENV: appEnv,
    APP_URL: production ? "https://sheets.example.com" : "http://127.0.0.1:47330",
    DATABASE_URL: `postgresql://u:p@127.0.0.1:47322/${
      appEnv === "test" ? "jdsheets_test" : appEnv === "development" ? "jdsheets_dev" : "jdsheets"
    }`,
    COLLAB_URL: "http://127.0.0.1:47331",
    COLLAB_TOKEN_SECRET: production ? "a".repeat(48) : "test-only-collab-secret-0123456789abcdef",
    INTERNAL_SERVICE_TOKEN: production ? "b".repeat(48) : "test-only-internal-token-0123456789abcdef",
    WORKBOOK_VALIDATOR: production ? "collab" : "fake",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: "./storage/test",
    NETWORK_ENFORCEMENT: production ? "on" : "off",
    MAIL_DRIVER: production ? "smtp" : "fake",
    DEV_PRINCIPAL: "off",
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}
