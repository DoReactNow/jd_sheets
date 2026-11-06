// The caller's address, read exactly as the Rust service reads it (contracts/client-ip/cases.json).
import { isIP } from "node:net";

export const UNKNOWN_IP = "unknown";

/** IPv4-mapped IPv6 ("::ffff:203.0.113.7") becomes plain IPv4. */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(ip);
  return mapped && isIP(mapped[1]) === 4 ? mapped[1] : ip;
}

/**
 * Counted from the right of X-Forwarded-For (Decision 18): each proxy appends the address it saw,
 * so entries further left can be faked by the caller. Returns null when no trustworthy address
 * can be read.
 */
export function clientIpFromForwarded(
  forwardedFor: string | null,
  trustedProxyHops: number,
): string | null {
  const entries = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const candidate = entries[entries.length - trustedProxyHops];
  if (trustedProxyHops < 1 || !candidate || !isIP(candidate)) return null;
  return normalizeIp(candidate);
}

/** For limits and logs: the caller's address, or "unknown". */
export function clientIp(headers: Headers, trustedProxyHops: number): string {
  return clientIpFromForwarded(headers.get("x-forwarded-for"), trustedProxyHops) ?? UNKNOWN_IP;
}
