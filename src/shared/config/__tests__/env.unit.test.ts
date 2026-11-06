// P0-ENV-01, P0-ENV-02, P0-ENV-03, P0-ACC-01: the environment loader's refusals.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv, type EnvSource } from "../env";

const realSecret = () => randomBytes(32).toString("base64");

function devSource(overrides: EnvSource = {}): EnvSource {
  return {
    APP_ENV: "development",
    APP_URL: "http://127.0.0.1:47320",
    LOG_LEVEL: "debug",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:47322/jdsheets_dev",
    DEV_PRINCIPAL: "on",
    COLLAB_URL: "http://127.0.0.1:47321",
    COLLAB_TOKEN_SECRET: "dev-only-collab-secret-change-me-0123456789",
    INTERNAL_SERVICE_TOKEN: "dev-only-internal-token-change-me-0123456789",
    WORKBOOK_VALIDATOR: "collab",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: "./storage/dev",
    ...overrides,
  };
}

function prodSource(overrides: EnvSource = {}): EnvSource {
  return devSource({
    APP_ENV: "production",
    APP_URL: "https://sheets.example.com",
    LOG_LEVEL: "info",
    DATABASE_URL: "postgresql://user:pass@db:5432/jdsheets",
    DEV_PRINCIPAL: "off",
    NETWORK_ENFORCEMENT: "on",
    TRUSTED_PROXY_HOPS: "1",
    COLLAB_URL: "http://collab:47321",
    COLLAB_TOKEN_SECRET: realSecret(),
    INTERNAL_SERVICE_TOKEN: realSecret(),
    MAIL_DRIVER: "smtp",
    ...overrides,
  });
}

describe("parseEnv: required values (P0-ENV-03)", () => {
  it("throws a clear error naming a missing required value", () => {
    const source = devSource();
    delete source.DATABASE_URL;
    expect(() => parseEnv(source)).toThrow(/DATABASE_URL/);
  });

  it("does not put secret values in the error message", () => {
    const secret = "short-secret";
    expect(() => parseEnv(devSource({ COLLAB_TOKEN_SECRET: secret }))).toThrow(
      /COLLAB_TOKEN_SECRET/,
    );
    try {
      parseEnv(devSource({ COLLAB_TOKEN_SECRET: secret }));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("parses a valid development source with typed values", () => {
    const env = parseEnv(devSource());
    expect(env.APP_ENV).toBe("development");
    expect(env.TRUSTED_PROXY_HOPS).toBe(0);
    expect(env.NETWORK_ENFORCEMENT).toBe("off");
    expect(env.databaseName).toBe("jdsheets_dev");
  });

  it("rejects unknown driver values", () => {
    expect(() => parseEnv(devSource({ STORAGE_DRIVER: "floppy" }))).toThrow(/STORAGE_DRIVER/);
    expect(() => parseEnv(devSource({ WORKBOOK_VALIDATOR: "maybe" }))).toThrow(
      /WORKBOOK_VALIDATOR/,
    );
    expect(() => parseEnv(devSource({ DEV_PRINCIPAL: "yes" }))).toThrow(/DEV_PRINCIPAL/);
  });

  it("requires STORAGE_LOCAL_DIR for the local driver and the S3 settings for s3", () => {
    const source = devSource();
    delete source.STORAGE_LOCAL_DIR;
    expect(() => parseEnv(source)).toThrow(/STORAGE_LOCAL_DIR/);
    expect(() => parseEnv(devSource({ STORAGE_DRIVER: "s3" }))).toThrow(/STORAGE_S3_BUCKET/);
  });
});

describe("parseEnv: test database guard (P0-ENV-01)", () => {
  it("refuses APP_ENV=test with a database not ending in _test", () => {
    expect(() => parseEnv(devSource({ APP_ENV: "test" }))).toThrow(/refusing to run/i);
  });

  it("accepts APP_ENV=test with a _test database", () => {
    const env = parseEnv(
      devSource({
        APP_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@127.0.0.1:47322/jdsheets_test",
      }),
    );
    expect(env.databaseName).toBe("jdsheets_test");
  });

  it("refuses APP_ENV=production with a _test database", () => {
    expect(() =>
      parseEnv(prodSource({ DATABASE_URL: "postgresql://user:pass@db:5432/jdsheets_test" })),
    ).toThrow(/refusing to run/i);
  });
});

describe("parseEnv: production refusals (P0-ENV-02, P0-ACC-01)", () => {
  it("accepts a valid production source", () => {
    expect(parseEnv(prodSource()).APP_ENV).toBe("production");
  });

  it("refuses the development principal in production, allows it in development and test", () => {
    expect(() => parseEnv(prodSource({ DEV_PRINCIPAL: "on" }))).toThrow(/DEV_PRINCIPAL/);
    expect(parseEnv(devSource({ DEV_PRINCIPAL: "on" })).DEV_PRINCIPAL).toBe("on");
  });

  it("refuses network enforcement off in production", () => {
    expect(() => parseEnv(prodSource({ NETWORK_ENFORCEMENT: "off" }))).toThrow(
      /NETWORK_ENFORCEMENT/,
    );
  });

  it("refuses fake drivers in production", () => {
    expect(() => parseEnv(prodSource({ WORKBOOK_VALIDATOR: "fake" }))).toThrow(
      /WORKBOOK_VALIDATOR/,
    );
    expect(() => parseEnv(prodSource({ MAIL_DRIVER: "fake" }))).toThrow(/MAIL_DRIVER/);
  });

  it("refuses development placeholder secrets in production", () => {
    expect(() =>
      parseEnv(prodSource({ COLLAB_TOKEN_SECRET: "dev-only-collab-secret-change-me-0123456789" })),
    ).toThrow(/COLLAB_TOKEN_SECRET/);
    expect(() =>
      parseEnv(prodSource({ INTERNAL_SERVICE_TOKEN: "test-only-internal-token-0123456789abcdef" })),
    ).toThrow(/INTERNAL_SERVICE_TOKEN/);
  });

  it("refuses a value left as the example file's placeholder, and plain http", () => {
    expect(() => parseEnv(prodSource({ STORAGE_LOCAL_DIR: "<path>" }))).toThrow(
      /STORAGE_LOCAL_DIR still holds/,
    );
    expect(() => parseEnv(prodSource({ APP_URL: "http://sheets.example.com" }))).toThrow(
      /must start with https/,
    );
  });
});

describe("example env files", () => {
  const read = (file: string): EnvSource => parse(readFileSync(file, "utf8"));

  it(".env.example parses", () => {
    expect(parseEnv(read(".env.example")).APP_ENV).toBe("development");
  });

  it(".env.test.example parses", () => {
    expect(parseEnv(read(".env.test.example")).APP_ENV).toBe("test");
  });

  it(".env.production.example parses once its placeholders are replaced", () => {
    const source = read(".env.production.example");
    for (const [name, value] of Object.entries(source)) {
      if (!value?.includes("<")) continue;
      source[name] = /SECRET|TOKEN/.test(name)
        ? realSecret()
        : name === "APP_URL"
          ? "https://sheets.example.com"
          : name === "DATABASE_URL"
            ? "postgresql://user:pass@db:5432/jdsheets"
            : "replaced-value";
    }
    expect(parseEnv(source).APP_ENV).toBe("production");
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("validates lazily on first call, not at import", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const mod = await import("../env");
    expect(() => mod.getEnv()).toThrow(/DATABASE_URL/);
  });
});
