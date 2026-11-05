// Display helpers for workbook lists (browser-safe).
import { formatRecent, parseInstant, systemClock } from "@/shared/time";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatChanged(iso: string): string {
  return formatRecent(parseInstant(iso), systemClock);
}
