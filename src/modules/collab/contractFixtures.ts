// Builds contracts/collab-token/cases.json: every case the Rust verifier must decide. Written by
// `npm run contracts:generate`; the contract tests regenerate it in memory and fail on drift.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { createTestClock, parseInstant } from "@/shared/time";
import { collabClaims, signClaims } from "./token";

export const FIXTURE_SECRET = "contract-fixture-secret-0123456789abcdef";
const OTHER_SECRET = "a-different-secret-0123456789abcdef0123";
export const FIXTURE_NOW = "2027-01-01T00:00:00.000Z";

export interface TokenCase {
  name: string;
  token: string;
  /** The address the connection comes from. */
  connectionIp: string;
  /** "ok" or the verifier's error name. */
  expect: "ok" | "invalid" | "expired" | "not_yet_valid" | "ip_mismatch";
}

export interface TokenFixtures {
  secret: string;
  nowUnix: number;
  cases: TokenCase[];
}

const base = () =>
  collabClaims({
    userId: "0190f1e2-0000-7000-8000-0000000000a1",
    sessionId: "0190f1e2-0000-7000-8000-0000000000b1",
    workbookId: "0190f1e2-0000-7000-8000-0000000000c1",
    role: "OWNER",
    ip: "203.0.113.7",
    displayName: "Asha",
    clock: createTestClock(FIXTURE_NOW),
    jti: "0190f1e2-0000-7000-8000-0000000000d1",
  });

const unsignedNone = (claims: Record<string, unknown>) => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.`;
};

export async function buildTokenFixtures(): Promise<TokenFixtures> {
  const now = Math.floor(parseInstant(FIXTURE_NOW).getTime() / 1000);
  const leeway = APP_CONFIG.collab.tokenLeewaySeconds;
  const claims = base();
  const sign = (c: Record<string, unknown>, secret = FIXTURE_SECRET) => signClaims(c, secret);
  const { sid: _dropped, ...withoutSid } = claims;

  const cases: TokenCase[] = [
    { name: "valid", token: await sign({ ...claims }), connectionIp: "203.0.113.7", expect: "ok" },
    {
      name: "valid from the IPv4-mapped IPv6 form",
      token: await sign({ ...claims }),
      connectionIp: "::ffff:203.0.113.7",
      expect: "ok",
    },
    {
      name: "expired within the leeway",
      token: await sign({ ...claims, iat: now - 300 - leeway + 1, exp: now - leeway + 1 }),
      connectionIp: "203.0.113.7",
      expect: "ok",
    },
    {
      name: "expired beyond the leeway",
      token: await sign({ ...claims, iat: now - 300 - leeway - 1, exp: now - leeway - 1 }),
      connectionIp: "203.0.113.7",
      expect: "expired",
    },
    {
      name: "issued in the future",
      token: await sign({ ...claims, iat: now + leeway + 60, exp: now + leeway + 300 }),
      connectionIp: "203.0.113.7",
      expect: "not_yet_valid",
    },
    {
      name: "wrong audience",
      token: await sign({ ...claims, aud: "someone-else" }),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "wrong issuer",
      token: await sign({ ...claims, iss: "someone-else" }),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "wrong signature",
      token: await sign({ ...claims }, OTHER_SECRET),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "unsigned (alg none)",
      token: unsignedNone({ ...claims }),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "connection from another IP",
      token: await sign({ ...claims }),
      connectionIp: "198.51.100.1",
      expect: "ip_mismatch",
    },
    {
      name: "unknown role",
      token: await sign({ ...claims, role: "OWNER" }),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "missing claim",
      token: await sign({ ...withoutSid }),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "lifetime longer than allowed",
      token: await sign({ ...claims, exp: claims.iat + 3600 }),
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
    {
      name: "malformed token",
      token: "not.a.token",
      connectionIp: "203.0.113.7",
      expect: "invalid",
    },
  ];
  return { secret: FIXTURE_SECRET, nowUnix: now, cases };
}

/** The values the Rust service keeps its own copy of (P0-RUST-03). */
export function appConfigContract() {
  return {
    workbookMaxBytes: APP_CONFIG.workbooks.maxBytes,
    tokenTtlSeconds: APP_CONFIG.collab.tokenTtlSeconds,
    tokenLeewaySeconds: APP_CONFIG.collab.tokenLeewaySeconds,
    tokenIssuer: APP_CONFIG.collab.tokenIssuer,
    tokenAudience: APP_CONFIG.collab.tokenAudience,
  };
}
