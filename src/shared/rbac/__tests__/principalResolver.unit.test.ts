import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePrincipal } from "@/tests/setup/fakePrincipal";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).jdsheetsPrincipalResolver;
});

function stubEnv(appEnv: "test" | "development") {
  vi.stubEnv("APP_ENV", appEnv);
  vi.stubEnv("APP_URL", "http://127.0.0.1:47320");
  vi.stubEnv(
    "DATABASE_URL",
    `postgresql://u:p@127.0.0.1:47322/jdsheets_${appEnv === "test" ? "test" : "dev"}`,
  );
  vi.stubEnv("COLLAB_URL", "http://127.0.0.1:47321");
  vi.stubEnv("COLLAB_TOKEN_SECRET", "x".repeat(40));
  vi.stubEnv("INTERNAL_SERVICE_TOKEN", "y".repeat(40));
  vi.stubEnv("AUTH_SECRET", "z".repeat(40));
  vi.stubEnv("WORKBOOK_VALIDATOR", "fake");
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("STORAGE_LOCAL_DIR", "./storage/test");
}

const request = new Request("http://127.0.0.1/api/x");
const fake = (role: string) => fakePrincipal({ roleCode: role });

describe("principal resolver", () => {
  it("resolves no principal when nothing is configured", async () => {
    stubEnv("development");
    const { resolvePrincipal } = await import("../principalResolver");
    await expect(resolvePrincipal(request)).resolves.toBeNull();
  });

  it("uses the resolver configured by the composition root", async () => {
    stubEnv("development");
    const mod = await import("../principalResolver");
    mod.configurePrincipalResolver(async () => fake("MEMBER"));
    await expect(mod.resolvePrincipal(request)).resolves.toMatchObject({ roleCode: "MEMBER" });
  });

  it("lets a test override win, only when APP_ENV=test, and restores on null", async () => {
    stubEnv("test");
    const mod = await import("../principalResolver");
    mod.configurePrincipalResolver(async () => fake("MEMBER"));
    mod.setPrincipalResolverForTests(async () => fake("ADMIN"));
    await expect(mod.resolvePrincipal(request)).resolves.toMatchObject({ roleCode: "ADMIN" });
    mod.setPrincipalResolverForTests(null);
    await expect(mod.resolvePrincipal(request)).resolves.toMatchObject({ roleCode: "MEMBER" });
  });

  it("refuses the test override outside APP_ENV=test", async () => {
    stubEnv("development");
    const { setPrincipalResolverForTests } = await import("../principalResolver");
    expect(() => setPrincipalResolverForTests(async () => null)).toThrow(/APP_ENV=test/);
  });
});
