// Hand-written contract cases shared with the Rust service (written to contracts/ by
// scripts/generate-contracts.ts).
import type { ErrorCode } from "@/shared/errors/errorCatalog";

/** The only error codes the Rust service may answer; all are in the app's catalog. */
export const RUST_ERROR_CODES: ErrorCode[] = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "REQUEST_TOO_LARGE",
  "WORKBOOK_TOO_LARGE",
  "WORKBOOK_UNREADABLE",
  "INTERNAL",
];

export interface ClientIpCase {
  forwardedFor: string | null;
  trustedProxyHops: number;
  /** The address both sides must read, or null when none can be trusted. */
  expected: string | null;
}

/** Client IP behind trusted proxies (Decision 18). */
export const CLIENT_IP_CASES: ClientIpCase[] = [
  { forwardedFor: "203.0.113.7", trustedProxyHops: 1, expected: "203.0.113.7" },
  { forwardedFor: "6.6.6.6, 203.0.113.7", trustedProxyHops: 1, expected: "203.0.113.7" },
  { forwardedFor: "6.6.6.6,203.0.113.7, 10.0.0.2", trustedProxyHops: 2, expected: "203.0.113.7" },
  { forwardedFor: " 203.0.113.7 ", trustedProxyHops: 1, expected: "203.0.113.7" },
  { forwardedFor: "::ffff:203.0.113.7", trustedProxyHops: 1, expected: "203.0.113.7" },
  { forwardedFor: "2001:db8::1", trustedProxyHops: 1, expected: "2001:db8::1" },
  { forwardedFor: null, trustedProxyHops: 1, expected: null },
  { forwardedFor: "", trustedProxyHops: 1, expected: null },
  { forwardedFor: "not-an-ip", trustedProxyHops: 1, expected: null },
  { forwardedFor: "203.0.113.7", trustedProxyHops: 2, expected: null },
  { forwardedFor: "203.0.113.7:8080", trustedProxyHops: 1, expected: null },
];
