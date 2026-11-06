// GridCraft's host messages (Decision 7, project_data.md 4.6). This folder is the only code that
// knows their names (P0-ARCH-04). Shapes from vendor/gridcraft/apps/gridcraft-web/src/host.rs at
// our own copy (Decision 55); contracts/bridge/messages.json holds examples both sides agree on.
import { APP_CONFIG } from "@/shared/config/appConfig";

const P = APP_CONFIG.editor.messagePrefix;

export const MESSAGE = {
  ready: `${P}ready`,
  open: `${P}open`,
  save: `${P}save`,
  dirty: `${P}dirty`,
  failed: `${P}failed`,
  // Access mode (Decisions 43, 55): the access mode and "save now" for autosave.
  mode: `${P}mode`,
  saveNow: `${P}saveNow`,
  // Live editing (Phase 3, Decision 22).
  live: `${P}live`,
  command: `${P}command`,
  apply: `${P}apply`,
  resync: `${P}resync`,
  resyncNeeded: `${P}resyncNeeded`,
  selection: `${P}selection`,
  presence: `${P}presence`,
} as const;

/** What the person may do in the editor (access mode): from their role and the edit lease. */
export type EditorMode = "edit" | "comment" | "view";

export function modeMessage(mode: EditorMode): { type: string; mode: EditorMode } {
  return { type: MESSAGE.mode, mode };
}

export function saveNowMessage(): { type: string } {
  return { type: MESSAGE.saveNow };
}

export type IncomingMessage =
  | { type: "command"; clientCommandId: string; baseSeq: number; step: unknown }
  | { type: "resyncNeeded" }
  | { type: "selection"; sheetName: string; range: string }
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
export function parseIncoming(
  data: unknown,
  maxBytes = APP_CONFIG.editor.maxMessageBytes,
): IncomingMessage | null {
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
    case MESSAGE.resyncNeeded:
      return { type: "resyncNeeded" };
    case MESSAGE.selection: {
      const sheetName = field(data, "sheetName");
      const range = field(data, "range");
      if (typeof sheetName !== "string" || typeof range !== "string") return null;
      if (sheetName.length > 100 || range.length > 50) return null;
      return { type: "selection", sheetName, range };
    }
    case MESSAGE.command: {
      const clientCommandId = field(data, "clientCommandId");
      const baseSeq = field(data, "baseSeq");
      const step = field(data, "step");
      if (typeof clientCommandId !== "string" || clientCommandId.length > 80) return null;
      if (typeof baseSeq !== "number" || !Number.isInteger(baseSeq) || baseSeq < 0) return null;
      if (typeof step !== "string" || step.length > maxBytes) return null;
      try {
        return { type: "command", clientCommandId, baseSeq, step: JSON.parse(step) as unknown };
      } catch {
        return null;
      }
    }
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
export function openMessage(
  name: string,
  bytes: ArrayBuffer,
): { type: string; name: string; bytes: ArrayBuffer } {
  return { type: MESSAGE.open, name, bytes };
}

export function liveStartMessage(seq: number) {
  return { type: MESSAGE.live, seq };
}

/** `message` is the JSON text of what the server sent: an applied or a rejected change. */
export function applyMessage(message: unknown) {
  return { type: MESSAGE.apply, message: JSON.stringify(message) };
}

export function resyncMessage(name: string, bytes: ArrayBuffer, seq: number) {
  return { type: MESSAGE.resync, name, bytes, seq };
}

export interface PresencePerson {
  name: string;
  colour: string;
  sheetName: string;
  range: string;
}

export function presenceMessage(people: PresencePerson[]) {
  return { type: MESSAGE.presence, people: JSON.stringify(people) };
}

/** True for the file kind the editor hands over on Save (an .xlsx workbook). */
export function isWorkbookFile(name: string): boolean {
  return name.toLowerCase().endsWith(`.${APP_CONFIG.workbooks.extension}`);
}
