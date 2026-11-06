// The editing session of one editor page (Decisions 21, 52): which mode the editor is in, the
// edit lease (take, renew every 30 s, move it from another tab, release on close) and autosave
// (5 s after the last change, at most 30 s after the first unsaved one; never in view mode).
// Timers and the API are injected, so it is tested without a browser (P2-LEASE-*, P2-SAVE-*).
import type { EditorMode } from "../bridge/messages";

export type WorkbookRoleCode = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export type LeaseAnswer =
  | { status: "HELD"; renewSeconds: number }
  | { status: "OTHER"; holderName: string }
  | { status: "ELSEWHERE" }
  | { status: "VIEW_ONLY" }
  | { status: "ERROR" };

/** What the page shows about editing, besides the mode. */
export type EditingNotice =
  | { kind: "none" }
  | { kind: "someone-else"; holderName: string }
  | { kind: "other-tab" }
  | { kind: "read-only" };

export interface SessionView {
  mode: EditorMode;
  notice: EditingNotice;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SessionDeps {
  role: WorkbookRoleCode;
  /** POST /api/workbooks/:id/lease */
  lease(takeOver: boolean): Promise<LeaseAnswer>;
  /** POST /api/workbooks/:id/lease/release (keepalive) */
  release(): void;
  /** Asks the editor to save (gridcraft:saveNow). */
  saveNow(): void;
  onChange(view: SessionView): void;
  timers: Timers;
  autosave: { idleMs: number; maxWaitMs: number; retryMs: number };
}

export interface EditingSession {
  start(): Promise<void>;
  stop(): void;
  view(): SessionView;
  /** "Refresh": ask for the lease again (another person was editing). */
  refresh(): Promise<void>;
  /** "Move editing here": take the lease from this person's other tab (Decision 52). */
  moveHere(): Promise<void>;
  /** The editor reported unsaved changes (true) or none (false). */
  dirtyChanged(dirty: boolean): void;
  /** A save finished: ok, or failed and should be retried. */
  saveFinished(ok: boolean): void;
  /** The server said the lease is gone (WORKBOOK_LOCKED, EDITING_ELSEWHERE): check again. */
  leaseLost(): Promise<void>;
}

const canEdit = (role: WorkbookRoleCode) => role === "OWNER" || role === "EDITOR";

export function createEditingSession(deps: SessionDeps): EditingSession {
  let view: SessionView =
    deps.role === "COMMENTER"
      ? { mode: "comment", notice: { kind: "none" } }
      : { mode: "view", notice: deps.role === "VIEWER" ? { kind: "read-only" } : { kind: "none" } };
  let renewTimer: unknown = null;
  let idleTimer: unknown = null;
  let maxTimer: unknown = null;
  let dirty = false;
  let stopped = false;
  let editable = canEdit(deps.role);

  const set = (next: SessionView) => {
    if (next.mode === view.mode && JSON.stringify(next.notice) === JSON.stringify(view.notice))
      return;
    view = next;
    deps.onChange(view);
    if (view.mode === "view") clearAutosave();
  };

  function clearAutosave() {
    if (idleTimer) deps.timers.clearTimeout(idleTimer);
    if (maxTimer) deps.timers.clearTimeout(maxTimer);
    idleTimer = null;
    maxTimer = null;
  }

  function fireAutosave() {
    clearAutosave();
    if (stopped || view.mode === "view" || !dirty) return;
    deps.saveNow();
  }

  function scheduleAutosave() {
    if (view.mode === "view" || stopped) return;
    if (idleTimer) deps.timers.clearTimeout(idleTimer);
    idleTimer = deps.timers.setTimeout(fireAutosave, deps.autosave.idleMs);
    maxTimer ??= deps.timers.setTimeout(fireAutosave, deps.autosave.maxWaitMs);
  }

  function apply(answer: LeaseAnswer) {
    if (renewTimer) deps.timers.clearTimeout(renewTimer);
    renewTimer = null;
    switch (answer.status) {
      case "HELD":
        set({ mode: "edit", notice: { kind: "none" } });
        renewTimer = deps.timers.setTimeout(() => void renew(false), answer.renewSeconds * 1000);
        break;
      case "OTHER":
        set({ mode: "view", notice: { kind: "someone-else", holderName: answer.holderName } });
        break;
      case "ELSEWHERE":
        set({ mode: "view", notice: { kind: "other-tab" } });
        break;
      case "VIEW_ONLY":
        // Edit rights were taken away while open (P2-LEASE-09).
        editable = false;
        set({ mode: "view", notice: { kind: "read-only" } });
        break;
      case "ERROR":
        // Keep what we have, and try again on the usual rhythm.
        if (view.mode === "edit")
          renewTimer = deps.timers.setTimeout(() => void renew(false), 5_000);
        break;
    }
  }

  async function renew(takeOver: boolean) {
    if (stopped || !editable) return;
    apply(await deps.lease(takeOver));
  }

  return {
    async start() {
      deps.onChange(view);
      if (editable) await renew(false);
    },
    stop() {
      stopped = true;
      if (renewTimer) deps.timers.clearTimeout(renewTimer);
      clearAutosave();
      if (view.mode === "edit") deps.release();
    },
    view: () => view,
    refresh: () => renew(false),
    moveHere: () => renew(true),
    dirtyChanged(next) {
      dirty = next;
      if (dirty) scheduleAutosave();
      else clearAutosave();
    },
    saveFinished(ok) {
      if (ok || !dirty || view.mode === "view") return;
      // Work is never silently lost: try again a little later (P2-SAVE-03).
      clearAutosave();
      idleTimer = deps.timers.setTimeout(fireAutosave, deps.autosave.retryMs);
    },
    leaseLost: () => renew(false),
  };
}
