// The only file that reads process.env (ESLint enforces this).
// Values are validated lazily on the first getEnv() call, never at import, so `next build`
// needs no database or secrets. Error messages name the variable but never echo its value.
import { z } from "zod";

export type EnvSource = Record<string, string | undefined>;

// Markers carried by the committed dev/test placeholder secrets; refused in production.
const PLACEHOLDER_MARKERS = ["dev-only", "test-only", "change-me"];

const isPlaceholder = (value: string) =>
  PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().includes(marker));

const onOff = (name: string) =>
  z.enum(["on", "off"], { error: `${name} must be on or off` }).default("off");

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`);

const baseSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"], {
    error: "APP_ENV must be development, test or production",
  }),
  APP_URL: z.url({ error: "APP_URL must be a full URL" }),
  LOG_LEVEL: z
    .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"], {
      error: "LOG_LEVEL must be silent, fatal, error, warn, info, debug or trace",
    })
    .default("info"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .regex(
      /^postgres(ql)?:\/\/[^/]+\/[^/?]+/,
      "DATABASE_URL must be a postgresql:// URL with a database name",
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Phase 0 only: every request runs as the development principal (Decision 35). */
  DEV_PRINCIPAL: onOff("DEV_PRINCIPAL"),
  /** The app's IP rules (Decision 18). Required "on" in production. */
  NETWORK_ENFORCEMENT: onOff("NETWORK_ENFORCEMENT"),
  /** Proxies in front of the app that append to X-Forwarded-For. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** The Rust collab service, as the app reaches it. */
  COLLAB_URL: z.url({ error: "COLLAB_URL must be a full URL" }),
  COLLAB_TOKEN_SECRET: secret("COLLAB_TOKEN_SECRET"),
  INTERNAL_SERVICE_TOKEN: secret("INTERNAL_SERVICE_TOKEN"),
  WORKBOOK_VALIDATOR: z.enum(["collab", "fake"], {
    error: "WORKBOOK_VALIDATOR must be collab or fake",
  }),
  STORAGE_DRIVER: z.enum(["local", "s3"], { error: "STORAGE_DRIVER must be local or s3" }),
  STORAGE_LOCAL_DIR: z.string().min(1).optional(),
  STORAGE_S3_ENDPOINT: z.url().optional(),
  STORAGE_S3_REGION: z.string().min(1).optional(),
  STORAGE_S3_BUCKET: z.string().min(1).optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
  MAIL_DRIVER: z.enum(["fake", "smtp"], { error: "MAIL_DRIVER must be fake or smtp" }).default(
    "fake",
  ),
});

const S3_REQUIRED = [
  "STORAGE_S3_ENDPOINT",
  "STORAGE_S3_REGION",
  "STORAGE_S3_BUCKET",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
] as const;

const envSchema = baseSchema.superRefine((env, ctx) => {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });

  if (env.STORAGE_DRIVER === "local" && !env.STORAGE_LOCAL_DIR) {
    issue("STORAGE_LOCAL_DIR", "STORAGE_LOCAL_DIR is required when STORAGE_DRIVER=local");
  }
  if (env.STORAGE_DRIVER === "s3") {
    for (const name of S3_REQUIRED) {
      if (!env[name]) issue(name, `${name} is required when STORAGE_DRIVER=s3`);
    }
  }
  if (env.DEV_PRINCIPAL === "on" && env.APP_ENV === "production") {
    issue("DEV_PRINCIPAL", "DEV_PRINCIPAL=on is not allowed in production");
  }
  if (env.APP_ENV === "production") {
    for (const [name, value] of Object.entries(env)) {
      if (typeof value === "string" && value.startsWith("<")) {
        issue(name, `${name} still holds the example file's placeholder`);
      }
    }
    if (!env.APP_URL.startsWith("https://")) {
      issue("APP_URL", "APP_URL must start with https:// in production");
    }
    for (const name of ["COLLAB_TOKEN_SECRET", "INTERNAL_SERVICE_TOKEN"] as const) {
      if (isPlaceholder(env[name])) {
        issue(name, `${name} is a development placeholder; generate a real secret`);
      }
    }
    if (env.NETWORK_ENFORCEMENT !== "on") {
      issue("NETWORK_ENFORCEMENT", "NETWORK_ENFORCEMENT must be on in production");
    }
    if (env.WORKBOOK_VALIDATOR === "fake") {
      issue("WORKBOOK_VALIDATOR", 'WORKBOOK_VALIDATOR "fake" is not allowed in production');
    }
    if (env.MAIL_DRIVER === "fake") {
      issue("MAIL_DRIVER", 'MAIL_DRIVER "fake" is not allowed in production');
    }
  }
});

export type Env = z.infer<typeof baseSchema> & { databaseName: string };

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** Validates an environment source. Exported for tests; app code uses getEnv(). */
export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? "environment");
      // Zod's own wording can include the received value; keep only our messages.
      const message = issue.message.includes(name)
        ? issue.message
        : `${name} is missing or invalid`;
      return `  - ${message}`;
    });
    throw new EnvError(`Invalid environment configuration:\n${lines.join("\n")}`);
  }

  const env = { ...result.data, databaseName: databaseNameOf(result.data.DATABASE_URL) };
  const isTestDb = env.databaseName.endsWith("_test");
  if (env.APP_ENV === "test" && !isTestDb) {
    throw new EnvError(
      `Refusing to run: APP_ENV=test needs a database whose name ends in _test (got "${env.databaseName}").`,
    );
  }
  if (env.APP_ENV === "production" && isTestDb) {
    throw new EnvError(
      `Refusing to run: APP_ENV=production cannot use a test database (got "${env.databaseName}").`,
    );
  }
  return Object.freeze(env);
}

let cached: Env | undefined;

/** The validated environment. Validated on first use, then cached for the process. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
