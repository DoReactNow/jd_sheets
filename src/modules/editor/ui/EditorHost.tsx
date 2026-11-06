"use client";

// The editor page (Decisions 7, 21, 52): our top bar, and GridCraft in a same-origin iframe,
// connected by the bridge. The editor opens in the mode of the person's role and the edit lease
// (patch 0001): edit with the lease, comment for Commenters, view otherwise. Editors autosave
// 5 s after the last change (at most 30 s after the first); Ctrl/Cmd+S saves at once.
// Also: an old version (?version=) and an administrator's audited open (?admin=) in view mode.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiRequest } from "@/shared/api/client";
import { toFriendlyError, type FriendlyError } from "@/shared/api/friendlyError";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { SupportContact } from "@/shared/ui/SupportContact";
import { createEditorBridge, type BridgeState, type SaveOutcome } from "../bridge/editorBridge";
import type { EditorMode } from "../bridge/messages";
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
  const view: SessionView | null = fixed
    ? { mode: "view", notice: { kind: "read-only" } }
    : sessionView;
  const initialMode: EditorMode | null = fixed ? "view" : sessionMode;

  // 2. The editing session: mode, lease and autosave.
  useEffect(() => {
    if (!info || special || info.trashedAt) return;
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
  }, [info, special, tabId]);

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
        {mode === "edit" ? (
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

      {view?.notice.kind === "someone-else" ? (
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
