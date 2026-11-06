// A tiny ZIP reader and writer (stored entries only for writing), enough for the fake validator
// and for tests to build small workbooks without a dependency. Never used on hostile input
// beyond reading the central directory with bounds checks.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Writes a ZIP archive with stored (uncompressed) entries. */
export function writeZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(encoder.encode(name));
    const data = Buffer.from(typeof content === "string" ? encoder.encode(content) : content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]));
}

/** The entry names in a ZIP's central directory, or null when it is not a readable ZIP. */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
  // The end-of-central-directory record is within the last 64 KiB + 22 bytes.
  const start = Math.max(0, buffer.length - 0xffff - 22);
  let end = -1;
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) return null;
    const nameLength = buffer.readUInt16LE(position + 28);
    const extra = buffer.readUInt16LE(position + 30);
    const comment = buffer.readUInt16LE(position + 32);
    if (position + 46 + nameLength > buffer.length) return null;
    names.push(buffer.toString("utf8", position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extra + comment;
  }
  return names;
}

/**
 * The contents of a ZIP's stored (uncompressed) entries, by name; null when it is not a readable
 * ZIP or an entry is compressed. Enough for the fake validator, which only reads our own files.
 */
export function storedEntries(bytes: Uint8Array): Map<string, string> | null {
  const names = zipEntryNames(bytes);
  if (!names) return null;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, string>();
  let position = 0;
  while (position + 30 <= buffer.length && buffer.readUInt32LE(position) === 0x04034b50) {
    const method = buffer.readUInt16LE(position + 8);
    const size = buffer.readUInt32LE(position + 18);
    const nameLength = buffer.readUInt16LE(position + 26);
    const extra = buffer.readUInt16LE(position + 28);
    const name = buffer.toString("utf8", position + 30, position + 30 + nameLength);
    const start = position + 30 + nameLength + extra;
    if (method !== 0 || start + size > buffer.length) return null;
    entries.set(name, buffer.toString("utf8", start, start + size));
    position = start + size;
  }
  return entries;
}

/** A comment in a fake workbook: who wrote it, on which cell, and its text. */
export interface FakeComment {
  cell: string;
  author: string;
  text: string;
}

/** The part of a fake workbook that holds its comments (see minimalXlsx). */
export const FAKE_COMMENTS_PART = "xl/comments1.xml";

/** Reads the comments minimalXlsx wrote. */
export function fakeComments(xml: string | undefined): FakeComment[] {
  if (!xml) return [];
  const unescape = (text: string) =>
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  return [...xml.matchAll(/<comment ref="([^"]*)" author="([^"]*)">([^<]*)<\/comment>/g)].map(
    (m) => ({ cell: m[1]!, author: unescape(m[2]!), text: unescape(m[3]!) }),
  );
}

/** A minimal, valid one-sheet XLSX package (used by the fake validator and by tests). */
export function minimalXlsx(
  cells: Record<string, string> = {},
  comments: FakeComment[] = [],
): Uint8Array {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = new Map<number, string[]>();
  for (const [ref, value] of Object.entries(cells)) {
    const row = Number(/\d+$/.exec(ref)?.[0] ?? "1");
    const xml = /^-?\d+(\.\d+)?$/.test(value)
      ? `<c r="${ref}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
    rows.set(row, [...(rows.get(row) ?? []), xml]);
  }
  const sheetData = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, cellsXml]) => `<row r="${row}">${cellsXml.join("")}</row>`)
    .join("");
  return writeZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
    ...(comments.length > 0
      ? {
          [FAKE_COMMENTS_PART]: `<comments>${comments
            .map(
              (c) =>
                `<comment ref="${c.cell}" author="${escape(c.author).replace(/"/g, "&quot;")}">${escape(c.text)}</comment>`,
            )
            .join("")}</comments>`,
        }
      : {}),
  });
}
