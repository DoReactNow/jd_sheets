"use client";

// The editor page (Decisions 7, 21, 52): our top bar, and GridCraft in a same-origin iframe,
// connected by the bridge. The editor opens in the mode of the person's role and the edit lease
// (access mode): edit with the lease, comment for Commenters, view otherwise. Editors autosave
// 5 s after the last change (at most 30 s after the first); Ctrl/Cmd+S saves at once.
// Also: an old version (?version=) and an administrator's audited open (?admin=) in view mode.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiRequest } from "@/shared/api/client";
import { toFriendlyError, type FriendlyError } from "@/shared/api/friendlyError";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { systemClock } from "@/shared/time";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { SupportContact } from "@/shared/ui/SupportContact";
import { createEditorBridge, type BridgeState, type SaveOutcome } from "../bridge/editorBridge";
import type { EditorMode, PresencePerson } from "../bridge/messages";
import {
  createLiveConnection,
  type LiveConnection,
  type LiveRole,
  type LiveState,
  type SocketLike,
  type TokenResult,
} from "../live/liveConnection";
import {
  createEditingSession,
  type EditingSession,
  type LeaseAnswer,
  type SessionView,
  type WorkbookRoleCode,
} from "../session/editingSession";
import styles from "./EditorHost.module.css";

interface WorkbookInfo {
  id: string;
  title: string;
  role: WorkbookRoleCode;
  allowDownloadForReaders: boolean;
  trashedAt: string | null;
}

interface Me {
  displayName: string;
}

export interface EditorHostProps {
  workbookId: string;
  /** An old version to show in view mode (P2-VER-03). */
  versionId?: string;
  /** An administrator's audited open: the grant from POST /api/admin/workbooks/:id/open. */
  adminGrant?: string;
  adminTitle?: string;
  /** The Share dialog (sharing module), put in by the page. */
  renderShare?: (props: { workbookId: string; title: string; onClose: () => void }) => ReactNode;
  /** Version history (workbooks module), put in by the page. */
  renderHistory?: (props: {
    workbookId: string;
    canEdit: boolean;
    onClose: () => void;
    onRestored: () => void;
  }) => ReactNode;
}

const STATUS_TEXT: Record<BridgeState["status"], string> = {
  loading: "Opening…",
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  conflict: "Not saved",
  "save-failed": "Couldn't save",
  "load-failed": "Couldn't open",
  "editor-failed": "Couldn't start",
};

const MODE_TEXT: Record<EditorMode, string> = {
  edit: "Editing",
  comment: "Comment only",
  view: "View only",
};

function newTabId(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `tab-${Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function putWorkbook(
  id: string,
  bytes: Uint8Array,
  baseVersionId: string,
  options: { autosave: boolean; tabId?: string },
): Promise<SaveOutcome> {
  try {
    const headers: Record<string, string> = {
      "if-match": `"${baseVersionId}"`,
      "content-type": APP_CONFIG.workbooks.mediaType,
    };
    if (options.tabId) headers["x-editor-tab"] = options.tabId;
    const response = await fetch(
      `/api/workbooks/${id}/content${options.autosave ? "?autosave=1" : ""}`,
      { method: "PUT", headers, body: new Uint8Array(bytes), credentials: "same-origin" },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      return { ok: true, versionId: (body as { data: { versionId: string } }).data.versionId };
    }
    const error = toFriendlyError({ status: response.status, body });
    return {
      ok: false,
      conflict: error.code === "WORKBOOK_CHANGED",
      message: error.message,
      code: error.code,
    };
  } catch {
    return { ok: false, conflict: false, message: toFriendlyError({ networkError: true }).message };
  }
}

function downloadFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function askForLease(id: string, tabId: string, takeOver: boolean): Promise<LeaseAnswer> {
  const result = await apiRequest<LeaseAnswer>(`/api/workbooks/${id}/lease`, {
    method: "POST",
    body: { tabId, takeOver },
  });
  if (result.ok) return result.data;
  if (result.error.code === "NOT_FOUND" || result.error.code === "FORBIDDEN") {
    return { status: "VIEW_ONLY" };
  }
  return { status: "ERROR" };
}

/** The editor's mode for a live role; view-only while held or full. */
function modeForLive(role: LiveRole, viewOnly: boolean): EditorMode {
  if (viewOnly || role === "VIEWER") return "view";
  return role === "COMMENTER" ? "comment" : "edit";
}

async function fetchCollabToken(id: string): Promise<TokenResult> {
  const result = await apiRequest<{
    token: string;
    url: string;
    expiresAt: string;
    heldBy: string | null;
  }>(`/api/workbooks/${id}/collab-token`, { method: "POST" });
  if (result.ok) return { ok: true, ...result.data };
  return { ok: false, noAccess: result.error.code === "NOT_FOUND" };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function EditorHost({
  workbookId,
  versionId,
  adminGrant,
  adminTitle,
  renderShare,
  renderHistory,
}: EditorHostProps) {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const special = versionId ? "version" : adminGrant ? "admin" : null;
  const [info, setInfo] = useState<WorkbookInfo | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [state, setState] = useState<BridgeState>({
    status: "loading",
    baseVersionId: null,
    message: null,
  });
  const [sessionView, setView] = useState<SessionView | null>(null);
  const [sessionMode, setInitialMode] = useState<EditorMode | null>(null);
  const [copying, setCopying] = useState(false);
  const [panel, setPanel] = useState<"share" | "history" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bridgeRef = useRef<ReturnType<typeof createEditorBridge> | null>(null);
  const sessionRef = useRef<EditingSession | null>(null);
  const [tabId] = useState(newTabId);

  // 1. Who is asking, and what they may do here.
  useEffect(() => {
    let cancelled = false;
    const me = apiRequest<Me>("/api/me");
    if (special === "admin") {
      void me.then((m) => {
        if (cancelled) return;
        setInfo({
          id: workbookId,
          title: adminTitle ?? "Workbook",
          role: "VIEWER",
          allowDownloadForReaders: false,
          trashedAt: null,
        });
        setAuthor(m.ok ? m.data.displayName : "");
      });
    } else {
      void Promise.all([apiRequest<WorkbookInfo>(`/api/workbooks/${workbookId}`), me]).then(
        ([workbook, m]) => {
          if (cancelled) return;
          if (!workbook.ok) return setLoadError(workbook.error);
          setInfo(workbook.data);
          setAuthor(m.ok ? m.data.displayName : "");
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [workbookId, special, adminTitle]);

  // An old version, an administrator's open and a trashed workbook are always view only.
  const fixed = info !== null && (special !== null || info.trashedAt !== null);
  // Live editing first (Phase 3); the one-editor lease when the live service can't be reached.
  const [path, setPath] = useState<"live" | "fallback" | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const liveRef = useRef<LiveConnection | null>(null);
  const firstWorkbook = useRef<{ bytes: ArrayBuffer; seq: number } | null>(null);
  const liveMode: EditorMode | null =
    live?.role && path === "live"
      ? modeForLive(live.role, live.heldBy !== null || live.full)
      : null;
  const view: SessionView | null = fixed
    ? { mode: "view", notice: { kind: "read-only" } }
    : path === "live" && liveMode
      ? { mode: liveMode, notice: { kind: "none" } }
      : sessionView;
  const initialMode: EditorMode | null = fixed ? "view" : path === "live" ? liveMode : sessionMode;

  // 2a. Live editing: connect; switch to the lease when the service can't be reached.
  useEffect(() => {
    if (!info || special || info.trashedAt) return;
    let decided = false;
    const connection = createLiveConnection({
      fetchToken: () => fetchCollabToken(info.id),
      openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      onWorkbook: (bytes, seq, first) => {
        if (first) {
          firstWorkbook.current = { bytes, seq };
          decided = true;
          setPath("live");
        } else {
          bridgeRef.current?.resync(`${info.title}.${APP_CONFIG.workbooks.extension}`, bytes, seq);
        }
      },
      onServerMessage: (message) => bridgeRef.current?.apply(message),
      onState: (state) => {
        setLive(state);
        if (state.status === "unavailable" && !decided) {
          decided = true;
          setPath("fallback");
        }
      },
      timers: {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (h) => window.clearTimeout(h as number),
      },
      now: () => systemClock.now().getTime(),
    });
    liveRef.current = connection;
    connection.start();
    return () => {
      connection.stop();
      liveRef.current = null;
    };
  }, [info, special]);

  // The editor follows a role change or a full workbook at once (P3-WS-05).
  useEffect(() => {
    if (liveMode) bridgeRef.current?.setMode(liveMode);
  }, [liveMode]);

  // Others' selections in the grid (P3-PRES-02).
  useEffect(() => {
    if (!live) return;
    const people: PresencePerson[] = live.people
      .filter((p) => p.userId !== live.me && p.selection)
      .map((p) => ({
        name: p.name,
        colour: p.colour,
        sheetName: p.selection!.sheetName,
        range: p.selection!.range,
      }));
    bridgeRef.current?.presence(people);
  }, [live]);

  // 2b. The one-editor lease and autosave (Phase 2), only when live editing isn't available.
  useEffect(() => {
    if (!info || special || info.trashedAt || path !== "fallback") return;
    const session = createEditingSession({
      role: info.role,
      lease: (takeOver) => askForLease(info.id, tabId, takeOver),
      release: () => {
        void fetch(`/api/workbooks/${info.id}/lease/release`, {
          method: "POST",
          keepalive: true,
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tabId }),
        });
      },
      saveNow: () => bridgeRef.current?.saveNow(),
      onChange: (next) => {
        setView(next);
        bridgeRef.current?.setMode(next.mode);
      },
      timers: {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (h) => window.clearTimeout(h as number),
      },
      autosave: APP_CONFIG.autosave,
    });
    sessionRef.current = session;
    void session.start().then(() => setInitialMode(session.view().mode));
    const onHide = () => session.stop();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      session.stop();
      sessionRef.current = null;
    };
  }, [info, special, tabId, path]);

  const mayExport = info
    ? info.role === "OWNER" || info.role === "EDITOR" || info.allowDownloadForReaders
    : false;

  // 3. The bridge to the editor.
  useEffect(() => {
    if (!info || !initialMode) return;
    const contentUrl =
      special === "version"
        ? `/api/workbooks/${info.id}/versions/${versionId}/content`
        : special === "admin"
          ? `/api/admin/workbooks/${info.id}/content?grant=${encodeURIComponent(adminGrant ?? "")}`
          : `/api/workbooks/${info.id}/content`;
    let wasDirty = false;
    const bridge = createEditorBridge({
      host: window,
      editor: () => frame.current?.contentWindow ?? null,
      origin: window.location.origin,
      load: async () => {
        // Live: the workbook came from the server with the welcome.
        if (firstWorkbook.current) {
          const { bytes } = firstWorkbook.current;
          return {
            ok: true,
            workbook: {
              name: `${info.title}.${APP_CONFIG.workbooks.extension}`,
              bytes,
              versionId: "live",
            },
          };
        }
        try {
          const response = await fetch(contentUrl, { credentials: "same-origin" });
          if (!response.ok) {
            const body: unknown = await response.json().catch(() => undefined);
            return {
              ok: false,
              message: toFriendlyError({ status: response.status, body }).message,
            };
          }
          const versionTag = (response.headers.get("etag") ?? "").replace(/"/g, "");
          const bytes = await response.arrayBuffer();
          return {
            ok: true,
            workbook: {
              name: `${info.title}.${APP_CONFIG.workbooks.extension}`,
              bytes,
              versionId: versionTag || "none",
            },
          };
        } catch {
          return { ok: false, message: toFriendlyError({ networkError: true }).message };
        }
      },
      save: (bytes, base, options) => putWorkbook(info.id, bytes, base, { ...options, tabId }),
      liveStart: () => firstWorkbook.current?.seq ?? null,
      onCommand: (id, baseSeq, step) => liveRef.current?.sendCommand(id, baseSeq, step),
      onResyncNeeded: () => liveRef.current?.requestResync(),
      onSelection: (sheetName, range) => liveRef.current?.sendSelection(sheetName, range),
      onLiveSave: () => liveRef.current?.requestSnapshot(),
      onSaved: (outcome) => {
        sessionRef.current?.saveFinished(outcome.ok);
        if (
          !outcome.ok &&
          (outcome.code === "WORKBOOK_LOCKED" || outcome.code === "EDITING_ELSEWHERE")
        ) {
          void sessionRef.current?.leaseLost();
        }
      },
      download: (name, bytes) => {
        if (!mayExport) {
          setNotice("The owner has turned off downloads for this workbook.");
          return;
        }
        downloadFile(name, bytes);
      },
      onChange: (next) => {
        setState(next);
        const dirty = next.status === "unsaved";
        if (dirty !== wasDirty && (next.status === "unsaved" || next.status === "saved")) {
          wasDirty = dirty;
          sessionRef.current?.dirtyChanged(dirty);
        }
      },
    });
    bridgeRef.current = bridge;
    bridge.start();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bridge.hasUnsavedWork()) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      bridge.stop();
      bridgeRef.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [info, initialMode, special, versionId, adminGrant, tabId, mayExport]);

  const src = useMemo(() => {
    if (author === null || !initialMode) return null;
    const query = new URLSearchParams({
      host: "parent",
      chrome: "notitlebar",
      author,
      mode: initialMode,
    });
    return `${APP_CONFIG.editor.basePath}index.html?${query.toString()}`;
  }, [author, initialMode]);

  const rename = useCallback(
    async (title: string) => {
      setRenaming(false);
      if (!info || title.trim() === "" || title === info.title) return;
      const result = await apiRequest(`/api/workbooks/${info.id}`, {
        method: "PATCH",
        body: { title },
      });
      if (result.ok) setInfo({ ...info, title: title.trim() });
      else setNotice(result.error.message);
    },
    [info],
  );

  async function saveAsCopy() {
    const bytes = bridgeRef.current?.conflictedBytes();
    if (!info || !bytes) return;
    setCopying(true);
    const created = await apiRequest<{ id: string; currentVersionId: string }>("/api/workbooks", {
      method: "POST",
      body: { title: `${info.title} (copy)`.slice(0, APP_CONFIG.workbooks.titleMaxLength) },
    });
    if (created.ok) {
      const copyTab = newTabId();
      await askForLease(created.data.id, copyTab, false);
      const saved = await putWorkbook(created.data.id, bytes, created.data.currentVersionId, {
        autosave: false,
        tabId: copyTab,
      });
      if (saved.ok) {
        router.push(`/w/${created.data.id}`);
        return;
      }
    }
    setCopying(false);
    setState((current) => ({ ...current, message: "We couldn't save a copy. Please try again." }));
  }

  if (loadError) {
    return (
      <main className="message-page">
        <h1>Couldn&apos;t open this workbook</h1>
        <ErrorMessage error={loadError} />
        <p>
          <Link className="btn btn-primary" href="/">
            Back to your workbooks
          </Link>
        </p>
      </main>
    );
  }

  const failed = state.status === "editor-failed" || state.status === "load-failed";
  const role = info?.role;
  const canEdit = !special && (role === "OWNER" || role === "EDITOR");
  const mode = view?.mode ?? "view";

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/" className={styles.back} aria-label="Back to your workbooks">
          ←
        </Link>
        {renaming && info ? (
          <input
            className={styles.titleInput}
            aria-label="Workbook title"
            defaultValue={info.title}
            maxLength={APP_CONFIG.workbooks.titleMaxLength}
            autoFocus
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void rename(e.currentTarget.value);
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : canEdit ? (
          <button
            type="button"
            className={styles.titleButton}
            title="Rename"
            onClick={() => setRenaming(true)}
          >
            <h1 className={styles.title}>{info?.title ?? "Opening…"}</h1>
          </button>
        ) : (
          <h1 className={styles.title} title={info?.title}>
            {info?.title ?? "Opening…"}
          </h1>
        )}
        {path === "live" && live ? (
          <span
            className={styles.status}
            data-status={live.status === "live" ? "saved" : "unsaved"}
            role="status"
            aria-live="polite"
            data-testid={mode === "edit" ? "live-status" : "editor-mode"}
          >
            {live.status !== "live"
              ? "Reconnecting…"
              : mode !== "edit"
                ? MODE_TEXT[mode]
                : live.saving
                  ? "Saving a version…"
                  : "Live"}
          </span>
        ) : mode === "edit" ? (
          <span
            className={styles.status}
            data-status={state.status}
            role="status"
            aria-live="polite"
          >
            {STATUS_TEXT[state.status]}
          </span>
        ) : (
          <span className={styles.mode} data-testid="editor-mode">
            {MODE_TEXT[mode]}
            {mode === "comment" && state.status !== "saved" && state.status !== "loading"
              ? ` · ${STATUS_TEXT[state.status]}`
              : ""}
          </span>
        )}
        {path === "live" && live && live.people.length > 0 ? (
          <ul className={styles.people} aria-label="People in this workbook">
            {live.people.map((p) => (
              <li
                key={p.userId}
                className={styles.avatar}
                style={{ background: p.colour }}
                title={`${p.name}${p.userId === live.me ? " (you)" : ""} · ${p.role.toLowerCase()}`}
              >
                {initials(p.name)}
              </li>
            ))}
          </ul>
        ) : null}
        <div className={styles.actions}>
          {!special && role && role !== "VIEWER" ? (
            <button type="button" className="btn" onClick={() => setPanel("history")}>
              History
            </button>
          ) : null}
          {!special && mayExport ? (
            <a className="btn" href={`/api/workbooks/${workbookId}/download`} download>
              Download
            </a>
          ) : null}
          {!special && role === "OWNER" ? (
            <button type="button" className="btn btn-primary" onClick={() => setPanel("share")}>
              Share
            </button>
          ) : null}
        </div>
      </header>

      {path === "live" && live?.heldBy ? (
        <div className={styles.banner} role="status">
          <span>
            {live.heldBy} is editing without live editing. You can view it until they finish.
          </span>
        </div>
      ) : path === "live" && live?.full ? (
        <div className={styles.banner} role="status">
          <span>
            The most people who can edit this workbook at once are already editing. You can view it.
          </span>
        </div>
      ) : live?.status === "no-access" ? (
        <div className={styles.banner} role="alert">
          <span>You no longer have access to this workbook.</span>
          <Link className="btn" href="/">
            Back to your workbooks
          </Link>
        </div>
      ) : view?.notice.kind === "someone-else" ? (
        <div className={styles.banner} role="status">
          <span>
            {view.notice.holderName} is editing. You can view it; refresh to edit when they finish.
          </span>
          <button type="button" className="btn" onClick={() => void sessionRef.current?.refresh()}>
            Refresh
          </button>
        </div>
      ) : view?.notice.kind === "other-tab" ? (
        <div className={styles.banner} role="status">
          <span>You are editing this workbook in another tab.</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void sessionRef.current?.moveHere()}
          >
            Move editing here
          </button>
        </div>
      ) : special === "version" ? (
        <div className={`${styles.banner} ${styles.info}`} role="status">
          <span>
            You are looking at an older version. Restore it from History to make it current.
          </span>
          <Link className="btn" href={`/w/${workbookId}`}>
            Back to the current version
          </Link>
        </div>
      ) : special === "admin" ? (
        <div className={`${styles.banner} ${styles.info}`} role="status">
          <span>Opened as administrator, view only. This was recorded in the audit trail.</span>
        </div>
      ) : info?.trashedAt ? (
        <div className={`${styles.banner} ${styles.info}`} role="status">
          <span>This workbook is in the Trash. Restore it from the Trash to edit it.</span>
        </div>
      ) : null}

      {notice ? (
        <div className={styles.banner} role="alert">
          <span>{notice}</span>
          <button type="button" className="btn" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      ) : null}

      {state.status === "conflict" ? (
        <div className={styles.banner} role="alert">
          <span>{state.message}</span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload latest
          </button>
          <button type="button" className="btn btn-primary" onClick={saveAsCopy} disabled={copying}>
            {copying ? "Saving a copy…" : "Save mine as a copy"}
          </button>
        </div>
      ) : state.status === "save-failed" ? (
        <div className={styles.banner} role="alert">
          <span>
            {state.message} Your changes are still here; we will try again, or press Ctrl/⌘ + S.
          </span>
        </div>
      ) : null}

      {failed ? (
        <main className="message-page">
          <h1>
            {state.status === "editor-failed"
              ? "The editor couldn't start"
              : "Couldn't open this workbook"}
          </h1>
          <p>
            {state.message ??
              "Your browser may not support the editor. Try an up-to-date Chrome, Edge, Firefox or Safari."}
          </p>
          <SupportContact />
        </main>
      ) : null}

      {src ? (
        <iframe
          ref={frame}
          className={styles.frame}
          hidden={failed}
          src={src}
          title="Spreadsheet editor"
          data-testid="editor-frame"
        />
      ) : null}

      {panel === "share" && info && renderShare
        ? renderShare({ workbookId: info.id, title: info.title, onClose: () => setPanel(null) })
        : null}
      {panel === "history" && info && renderHistory
        ? renderHistory({
            workbookId: info.id,
            canEdit,
            onClose: () => setPanel(null),
            onRestored: () => window.location.reload(),
          })
        : null}
    </div>
  );
}
