import { describe, expect, it } from "vitest";
import { APP_CONFIG } from "../appConfig";

describe("APP_CONFIG", () => {
  it("exposes the product, company, domain and locale values", () => {
    expect(APP_CONFIG.product.name).toEqual(expect.any(String));
    expect(APP_CONFIG.company.legalName).toEqual(expect.any(String));
    expect(APP_CONFIG.company.allowedEmailDomain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    expect(APP_CONFIG.locale.businessTimezone).toBe("Asia/Kolkata");
  });

  it("keeps limits consistent", () => {
    expect(APP_CONFIG.workbooks.maxBytes).toBe(50 * 1024 * 1024);
    expect(APP_CONFIG.collab.tokenLeewaySeconds).toBeLessThan(APP_CONFIG.collab.tokenTtlSeconds);
    expect(APP_CONFIG.editor.basePath).toMatch(/^\/.*\/$/);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(APP_CONFIG)).toBe(true);
    expect(Object.isFrozen(APP_CONFIG.workbooks)).toBe(true);
    expect(Object.isFrozen(APP_CONFIG.collab)).toBe(true);
  });
});
