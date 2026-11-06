// The page side of the editor bridge (Decision 7). It answers the editor's messages:
//   ready → load the workbook from our API and send it   (P0-BRIDGE-01)
//   save  → store it as a new version with If-Match      (P0-BRIDGE-03, -04, -08)
//   dirty → "Unsaved changes" / "Saved"                  (P0-BRIDGE-05)
//   failed→ a friendly message                           (P0-BRIDGE-06)
// Only messages from the editor's own window, on our own origin, are heard (P0-BRIDGE-02).
// Everything outside (network, DOM, navigation) is injected, so it is tested without a browser.
import {
  applyMessage,
  isWorkbookFile,
  liveStartMessage,
  modeMessage,
  openMessage,
  parseIncoming,
  presenceMessage,
  resyncMessage,
  saveNowMessage,
  type EditorMode,
  type PresencePerson,
} from "./messages";

export type BridgeStatus =
  | "loading" // waiting for the editor or the workbook
  | "saved"
  | "unsaved"
  | "saving"
  | "conflict" // the workbook moved on since it was opened (WORKBOOK_CHANGED)
  | "save-failed" // a save failed for another reason; work is still in the editor
  | "load-failed"
  | "editor-failed";

export interface BridgeState {
  status: BridgeStatus;
  /** The version the next save is based on. */
  baseVersionId: string | null;
  /** A friendly message for the failure states (already mapped from the catalog). */
  message: string | null;
}

export interface LoadedWorkbook {
  name: string;
  bytes: ArrayBuffer;
  versionId: string;
}

export type SaveOutcome =
  | { ok: true; versionId: string }
  | {
      ok: false;
      conflict: boolean;
      message: string;
      /** The catalog code, so the page can react (WORKBOOK_LOCKED: check the lease again). */
      code?: string;
    };

export interface BridgeDeps {
  /** The window the editor's messages arrive at (the page's own window). */
  host: Pick<Window, "addEventListener" | "removeEventListener">;
  /** The editor iframe's window; messages from anything else are ignored. */
  editor: () => (Pick<Window, "postMessage"> & object) | null;
  /** Our own origin; the only one heard and posted to. */
  origin: string;
  load: () => Promise<{ ok: true; workbook: LoadedWorkbook } | { ok: false; message: string }>;
  save: (
    bytes: Uint8Array,
    baseVersionId: string,
    options: { autosave: boolean },
  ) => Promise<SaveOutcome>;
  /** Called after every save attempt (autosave retries, lease checks). */
  onSaved?: (outcome: SaveOutcome) => void;
  /** Files the editor hands over that are not the workbook (PDF exports) are downloaded. */
  download: (name: string, bytes: Uint8Array) => void;
  onChange: (state: BridgeState) => void;
  /**
   * Live editing (Phase 3): asked right after the workbook is opened; a sequence number makes
   * the editor go live there (the workbook then came from the server, not from load()).
   */
  liveStart?: () => number | null;
  /** Live editing (Phase 3): a change this person made, for the server. */
  onCommand?: (clientCommandId: string, baseSeq: number, step: unknown) => void;
  /** Live editing: the editor no longer agrees with the server and needs its workbook. */
  onResyncNeeded?: () => void;
  /** Live editing: where this person is, for presence. */
  onSelection?: (sheetName: string, range: string) => void;
}

export interface EditorBridge {
  start(): void;
  stop(): void;
  state(): BridgeState;
  /** Work that is not stored yet: the page asks before the person leaves (P0-BRIDGE-09). */
  hasUnsavedWork(): boolean;
  /** Bytes of the last save the server refused as a conflict, for "Save as a copy". */
  conflictedBytes(): Uint8Array | null;
  /** Switches the editor's access mode at once (P2-MODE-05). */
  setMode(mode: EditorMode): void;
  /** Asks the editor to save, for autosave; the save it hands over is marked as one. */
  saveNow(): void;
  /** Live editing: the server's workbook replaces the editor's (resync). */
  resync(name: string, bytes: ArrayBuffer, seq: number): void;
  /** Live editing: an applied or rejected change from the server. */
  apply(message: unknown): void;
  /** Live editing: where the others are. */
  presence(people: PresencePerson[]): void;
  /** True once the editor is live: its saves are the server's business, not ours. */
  isLive(): boolean;
}

export function createEditorBridge(deps: BridgeDeps): EditorBridge {
  let state: BridgeState = { status: "loading", baseVersionId: null, message: null };
  let dirty = false;
  let saving = false;
  let pending: Uint8Array | null = null;
  let conflicted: Uint8Array | null = null;
  let loaded = false;
  let autosaveRequested = false;
  let live = false;

  const set = (next: Partial<BridgeState>) => {
    state = { ...state, ...next };
    deps.onChange(state);
  };

  const settledStatus = (): BridgeStatus => (dirty ? "unsaved" : "saved");

  async function openInEditor() {
    if (loaded) return; // a second "ready" (editor reload) must not open a second copy
    loaded = true;
    const result = await deps.load();
    if (!result.ok) {
      loaded = false;
      set({ status: "load-failed", message: result.message });
      return;
    }
    const { workbook } = result;
    set({ baseVersionId: workbook.versionId });
    deps
      .editor()
      ?.postMessage(openMessage(workbook.name, workbook.bytes), deps.origin, [workbook.bytes]);
    const seq = deps.liveStart?.() ?? null;
    if (seq !== null) {
      live = true;
      deps.editor()?.postMessage(liveStartMessage(seq), deps.origin);
    }
    set({ status: "saved", message: null });
  }

  async function runSaves(bytes: Uint8Array) {
    saving = true;
    let next: Uint8Array | null = bytes;
    while (next) {
      const current = next;
      next = null;
      const base = state.baseVersionId;
      if (!base) break;
      set({ status: "saving", message: null });
      const autosave = autosaveRequested;
      autosaveRequested = false;
      const outcome = await deps.save(current, base, { autosave });
      deps.onSaved?.(outcome);
      if (outcome.ok) {
        set({ baseVersionId: outcome.versionId, status: settledStatus() });
      } else if (outcome.conflict) {
        conflicted = pending ?? current;
        pending = null;
        set({ status: "conflict", message: outcome.message });
        break;
      } else {
        set({ status: "save-failed", message: outcome.message });
      }
      next = pending;
      pending = null;
    }
    saving = false;
  }

  function onSave(name: string, bytes: Uint8Array) {
    if (!isWorkbookFile(name)) {
      deps.download(name, bytes);
      return;
    }
    if (live) return; // live: every change is already stored by the server
    if (state.status === "conflict" || !state.baseVersionId) return;
    if (saving) {
      pending = bytes; // only the newest pending save matters; it runs after the current one
      return;
    }
    void runSaves(bytes);
  }

  const listener = (event: MessageEvent) => {
    const editor = deps.editor();
    if (event.origin !== deps.origin || !editor || event.source !== editor) return;
    const message = parseIncoming(event.data);
    if (!message) return;
    switch (message.type) {
      case "ready":
        void openInEditor();
        break;
      case "dirty":
        dirty = message.dirty;
        if (state.status === "saved" || state.status === "unsaved")
          set({ status: settledStatus() });
        break;
      case "save":
        onSave(message.name, message.bytes);
        break;
      case "failed":
        set({ status: "editor-failed", message: null });
        break;
      case "command":
        deps.onCommand?.(message.clientCommandId, message.baseSeq, message.step);
        break;
      case "resyncNeeded":
        deps.onResyncNeeded?.();
        break;
      case "selection":
        deps.onSelection?.(message.sheetName, message.range);
        break;
    }
  };

  return {
    start: () => deps.host.addEventListener("message", listener as EventListener),
    stop: () => deps.host.removeEventListener("message", listener as EventListener),
    state: () => state,
    hasUnsavedWork: () =>
      dirty || saving || pending !== null || ["conflict", "save-failed"].includes(state.status),
    conflictedBytes: () => conflicted,
    setMode: (mode) => deps.editor()?.postMessage(modeMessage(mode), deps.origin),
    resync(name, bytes, seq) {
      deps.editor()?.postMessage(resyncMessage(name, bytes, seq), deps.origin, [bytes]);
    },
    apply: (message) => deps.editor()?.postMessage(applyMessage(message), deps.origin),
    presence: (people) => deps.editor()?.postMessage(presenceMessage(people), deps.origin),
    isLive: () => live,
    saveNow: () => {
      if (!loaded || state.status === "conflict") return;
      autosaveRequested = true;
      deps.editor()?.postMessage(saveNowMessage(), deps.origin);
    },
  };
}
