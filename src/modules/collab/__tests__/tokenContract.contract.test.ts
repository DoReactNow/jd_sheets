// P0-TOKEN-01..08 (TypeScript side): the committed fixtures are exactly what the issuer produces
// today, so the Rust verifier is always tested against the real issuer. Also checks the other
// shared contracts are up to date.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/shared/errors/errorCatalog";
import { clientIpFromForwarded } from "@/shared/http/clientIp";
import { createTestClock } from "@/shared/time";
import { CLIENT_IP_CASES, RUST_ERROR_CODES } from "../contractCases";
import {
  appConfigContract,
  buildTokenFixtures,
  FIXTURE_NOW,
  FIXTURE_SECRET,
} from "../contractFixtures";
import { issueCollabToken } from "../token";

const read = (file: string) => JSON.parse(readFileSync(`contracts/${file}`, "utf8"));

describe("shared contracts are current (run npm run contracts:generate after a change)", () => {
  it("collab token cases", async () => {
    expect(read("collab-token/cases.json")).toEqual(await buildTokenFixtures());
  });
  it("shared limits (P0-RUST-03)", () => {
    expect(read("app-config.json")).toEqual(appConfigContract());
  });
  it("error codes, all of which exist in the app's catalog (P0-RUST-02)", () => {
    expect(read("error-codes.json")).toEqual(RUST_ERROR_CODES);
    for (const code of RUST_ERROR_CODES) expect(ERROR_CODES).toContain(code);
  });
  it("client IP cases", () => {
    expect(read("client-ip/cases.json")).toEqual(CLIENT_IP_CASES);
  });
});

describe("the issuer", () => {
  it("produces the fixture's valid token for the same input (P0-TOKEN-01)", async () => {
    const token = await issueCollabToken({
      userId: "0190f1e2-0000-7000-8000-0000000000a1",
      sessionId: "0190f1e2-0000-7000-8000-0000000000b1",
      workbookId: "0190f1e2-0000-7000-8000-0000000000c1",
      role: "OWNER",
      ip: "203.0.113.7",
      displayName: "Asha",
      clock: createTestClock(FIXTURE_NOW),
      secret: FIXTURE_SECRET,
      jti: "0190f1e2-0000-7000-8000-0000000000d1",
    });
    const valid = read("collab-token/cases.json").cases.find(
      (c: { name: string }) => c.name === "valid",
    );
    expect(token).toBe(valid.token);
  });
});

describe("client IP (TypeScript side)", () => {
  it.each(CLIENT_IP_CASES)("$forwardedFor with $trustedProxyHops hop(s)", (c) => {
    expect(clientIpFromForwarded(c.forwardedFor, c.trustedProxyHops)).toBe(c.expected);
  });
});
