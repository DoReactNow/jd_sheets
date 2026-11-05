// UUID v7 (time-ordered) IDs made in the app, for records whose ID must be known before they are
// written, such as a workbook version whose storage key includes it. The time comes from a Clock.
import { randomBytes } from "node:crypto";
import type { Clock } from "@/shared/time";

export function uuid7(clock: Clock): string {
  const bytes = randomBytes(16);
  const ms = BigInt(clock.now().getTime());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
