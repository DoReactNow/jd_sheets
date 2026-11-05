import { stubEnvFor } from "@/tests/setup/stubEnv";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(appEnv: "test" | "development" | "production") {
  stubEnvFor(appEnv);
  return import("../testOnly");
}

describe("test-only features", () => {
  it("are enabled only when APP_ENV=test", async () => {
    expect((await load("test")).isTestEnvironment()).toBe(true);
  });

  it.each(["development", "production"] as const)(
    "are unreachable when APP_ENV=%s (404 NOT_FOUND)",
    async (appEnv) => {
      const { assertTestEnvironment, isTestEnvironment } = await load(appEnv);
      expect(isTestEnvironment()).toBe(false);
      expect(() => assertTestEnvironment()).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    },
  );
});
