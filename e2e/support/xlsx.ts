// Reads one part of an .xlsx (a ZIP) so E2E tests can check what was really saved, without
// reading the canvas (Rule 18). Handles stored and deflated entries.
import { inflateRawSync } from "node:zlib";

export function readZipEntry(bytes: Buffer, name: string): string | null {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 0xffff - 22); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = bytes.readUInt16LE(end + 10);
  let position = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(position + 10);
    const compressedSize = bytes.readUInt32LE(position + 20);
    const nameLength = bytes.readUInt16LE(position + 28);
    const extra = bytes.readUInt16LE(position + 30);
    const comment = bytes.readUInt16LE(position + 32);
    const localOffset = bytes.readUInt32LE(position + 42);
    const entryName = bytes.toString("utf8", position + 46, position + 46 + nameLength);
    if (entryName === name) {
      const localName = bytes.readUInt16LE(localOffset + 26);
      const localExtra = bytes.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const data = bytes.subarray(start, start + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    position += 46 + nameLength + extra + comment;
  }
  return null;
}

/** The formula and cached value of a cell in the first sheet, from its XML. */
export function cellOf(
  sheetXml: string,
  ref: string,
): { formula: string | null; value: string | null } {
  const match = new RegExp(`<c r="${ref}"[^>]*>([\\s\\S]*?)</c>`).exec(sheetXml);
  if (!match) return { formula: null, value: null };
  const formula = /<f[^>]*>([\s\S]*?)<\/f>/.exec(match[1])?.[1] ?? null;
  const value = /<v>([\s\S]*?)<\/v>/.exec(match[1])?.[1] ?? null;
  return { formula, value };
}
