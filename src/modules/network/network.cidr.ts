// CIDR ranges and address matching for IPv4 and IPv6 (P1-NET-03, -04, -11). Pure functions.
import { isIP } from "node:net";
import { normalizeIp } from "@/shared/http/clientIp";

export interface Cidr {
  version: 4 | 6;
  base: bigint;
  prefix: number;
  /** Canonical text, e.g. "203.0.113.0/24". */
  text: string;
}

function ipToBigInt(ip: string): { version: 4 | 6; value: bigint } | null {
  const plain = normalizeIp(ip);
  const version = isIP(plain);
  if (version === 4) {
    const value = plain.split(".").reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
    return { version: 4, value };
  }
  if (version === 6) {
    const [head, tail = ""] = plain.split("::");
    const parse = (part: string) => (part ? part.split(":") : []);
    let groups = [...parse(head)];
    let tailGroups = parse(tail);
    // An embedded IPv4 tail ("::ffff:1.2.3.4" not mapped, or "64:ff9b::1.2.3.4").
    const last = (plain.includes("::") ? tailGroups : groups).at(-1);
    if (last && last.includes(".")) {
      const v4 = ipToBigInt(last);
      if (!v4 || v4.version !== 4) return null;
      const hex = [(v4.value >> 16n).toString(16), (v4.value & 0xffffn).toString(16)];
      if (plain.includes("::")) tailGroups = [...tailGroups.slice(0, -1), ...hex];
      else groups = [...groups.slice(0, -1), ...hex];
    }
    const missing = 8 - groups.length - tailGroups.length;
    const all = plain.includes("::")
      ? [...groups, ...Array(missing).fill("0"), ...tailGroups]
      : groups;
    if (all.length !== 8) return null;
    const value = all.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || "0", 16)), 0n);
    return { version: 6, value };
  }
  return null;
}

function bigIntToIp(version: 4 | 6, value: bigint): string {
  if (version === 4)
    return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".");
  const groups = Array.from({ length: 8 }, (_, i) =>
    ((value >> BigInt((7 - i) * 16)) & 0xffffn).toString(16),
  );
  // Compress the longest run of zero groups.
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === "0") j++;
    if (j - i > bestLength && j - i > 1) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  if (bestStart < 0) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLength).join(":")}`;
}

/** Parses "203.0.113.7", "203.0.113.0/24" or "2001:db8::/32". Null when malformed. */
export function parseCidr(input: string): Cidr | null {
  const text = input.trim();
  const [address, prefixText, extra] = text.split("/");
  if (extra !== undefined || !address) return null;
  const ip = ipToBigInt(address);
  if (!ip) return null;
  const bits = ip.version === 4 ? 32 : 128;
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (prefix < 0 || prefix > bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  const base = ip.value & mask;
  return { version: ip.version, base, prefix, text: `${bigIntToIp(ip.version, base)}/${prefix}` };
}

export function cidrContains(cidr: Cidr, ip: string): boolean {
  const parsed = ipToBigInt(ip);
  if (!parsed || parsed.version !== cidr.version) return false;
  const bits = cidr.version === 4 ? 32 : 128;
  const mask =
    cidr.prefix === 0 ? 0n : ((1n << BigInt(cidr.prefix)) - 1n) << BigInt(bits - cidr.prefix);
  return (parsed.value & mask) === cidr.base;
}

export function anyContains(cidrs: readonly Cidr[], ip: string | null): boolean {
  return ip !== null && cidrs.some((cidr) => cidrContains(cidr, ip));
}
