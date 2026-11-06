// Keyed hashes with AUTH_SECRET (Decision 48): rate-limit buckets, OTP codes and sign-up tickets.
// A leaked table cannot be checked against a list of emails, addresses or codes.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/shared/config/env";

export function keyedHash(purpose: string, value: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`${purpose}:${value}`).digest("hex");
}

export function bucketKey(kind: string, value: string): string {
  return `${kind}:${keyedHash("bucket", value).slice(0, 40)}`;
}

/** Constant-time comparison of two hex hashes (P1-OTP-11). */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
