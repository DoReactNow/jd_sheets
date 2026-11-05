// GridCraft's host messages (Decision 7, project_data.md 4.6). This folder is the only code that
// knows their names (P0-ARCH-04). Shapes from vendor/gridcraft/apps/gridcraft-web/src/host.rs at
// the pinned tag; contracts/bridge/messages.json holds examples both sides agree on.
import { APP_CONFIG } from "@/shared/config/appConfig";

const P = APP_CONFIG.editor.messagePrefix;

export const MESSAGE = {
  ready: `${P}ready`,
  open: `${P}open`,
  save: `${P}save`,
  dirty: `${P}dirty`,
  failed: `${P}failed`,
} as const;

export type IncomingMessage =
  | { type: "ready"; version: string | null }
  | { type: "save"; name: string; bytes: Uint8Array }
  | { type: "dirty"; dirty: boolean }
  | { type: "failed" };

const MAX_NAME = 300;

function field(data: object, key: string): unknown {
  return (data as Record<string, unknown>)[key];
}

/**
 * Reads a message from the editor. Anything malformed, unknown or too large is null and ignored
 * (P0-BRIDGE-07). The editor's own error text is never kept (it is never shown to users).
 */
export function parseIncoming(data: unknown, maxBytes = APP_CONFIG.editor.maxMessageBytes): IncomingMessage | null {
  if (!data || typeof data !== "object") return null;
  const type = field(data, "type");
  switch (type) {
    case MESSAGE.ready: {
      const version = field(data, "version");
      return { type: "ready", version: typeof version === "string" ? version.slice(0, 40) : null };
    }
    case MESSAGE.dirty: {
      const dirty = field(data, "dirty");
      return typeof dirty === "boolean" ? { type: "dirty", dirty } : null;
    }
    case MESSAGE.failed:
      return { type: "failed" };
    case MESSAGE.save: {
      const name = field(data, "name");
      const raw = field(data, "bytes");
      if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME) return null;
      let bytes: Uint8Array | null = null;
      if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
      else if (raw instanceof Uint8Array) bytes = raw;
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
      return { type: "save", name, bytes };
    }
    default:
      return null;
  }
}

/** The message that opens a workbook in the editor. The buffer is transferred, not copied. */
export function openMessage(name: string, bytes: ArrayBuffer): { type: string; name: string; bytes: ArrayBuffer } {
  return { type: MESSAGE.open, name, bytes };
}

/** True for the file kind the editor hands over on Save (an .xlsx workbook). */
export function isWorkbookFile(name: string): boolean {
  return name.toLowerCase().endsWith(`.${APP_CONFIG.workbooks.extension}`);
}
