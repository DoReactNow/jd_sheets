"use client";

// The editor page (Decision 7): our top bar, and GridCraft in a same-origin iframe, connected by
// the bridge. Saving: GridCraft's Save (Ctrl/Cmd+S or File › Save) hands the workbook to us and
// we store it as a new version.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import { toFriendlyError, type FriendlyError } from "@/shared/api/friendlyError";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { SupportContact } from "@/shared/ui/SupportContact";
import { createEditorBridge, type BridgeState, type SaveOutcome } from "../bridge/editorBridge";
import styles from "./EditorHost.module.css";

interface WorkbookInfo {
  id: string;
  title: string;
}

interface Me {
  displayName: string;
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

async function putWorkbook(id: string, bytes: Uint8Array, baseVersionId: string): Promise<SaveOutcome> {
  try {
    const response = await fetch(`/api/workbooks/${id}/content`, {
      method: "PUT",
      headers: { "if-match": `"${baseVersionId}"`, "content-type": APP_CONFIG.workbooks.mediaType },
      body: new Uint8Array(bytes),
      credentials: "same-origin",
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      return { ok: true, versionId: (body as { data: { versionId: string } }).data.versionId };
    }
    const error = toFriendlyError({ status: response.status, body });
    return { ok: false, conflict: error.code === "WORKBOOK_CHANGED", message: error.message };
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

export function EditorHost({ workbookId }: { workbookId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [info, setInfo] = useState<WorkbookInfo | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<FriendlyError | null>(null);
  const [state, setState] = useState<BridgeState>({ status: "loading", baseVersionId: null, message: null });
  const [copying, setCopying] = useState(false);
  const bridgeRef = useRef<ReturnType<typeof createEditorBridge> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiRequest<WorkbookInfo>(`/api/workbooks/${workbookId}`),
      apiRequest<Me>("/api/me"),
    ]).then(([workbook, me]) => {
      if (cancelled) return;
      if (!workbook.ok) return setLoadError(workbook.error);
      setInfo(workbook.data);
      setAuthor(me.ok ? me.data.displayName : "");
    });
    return () => {
      cancelled = true;
    };
  }, [workbookId]);

  useEffect(() => {
    if (!info) return;
    const bridge = createEditorBridge({
      host: window,
      editor: () => frame.current?.contentWindow ?? null,
      origin: window.location.origin,
      load: async () => {
        try {
          const response = await fetch(`/api/workbooks/${info.id}/content`, { credentials: "same-origin" });
          if (!response.ok) {
            const body: unknown = await response.json().catch(() => undefined);
            return { ok: false, message: toFriendlyError({ status: response.status, body }).message };
          }
          const versionId = (response.headers.get("etag") ?? "").replace(/"/g, "");
          const bytes = await response.arrayBuffer();
          return { ok: true, workbook: { name: `${info.title}.${APP_CONFIG.workbooks.extension}`, bytes, versionId } };
        } catch {
          return { ok: false, message: toFriendlyError({ networkError: true }).message };
        }
      },
      save: (bytes, base) => putWorkbook(info.id, bytes, base),
      download: downloadFile,
      onChange: setState,
    });
    bridgeRef.current = bridge;
    bridge.start();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bridge.hasUnsavedWork()) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      bridge.stop();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [info]);

  const src = useMemo(() => {
    if (author === null) return null;
    const query = new URLSearchParams({ host: "parent", chrome: "notitlebar", author });
    return `${APP_CONFIG.editor.basePath}index.html?${query.toString()}`;
  }, [author]);

  async function saveAsCopy() {
    const bytes = bridgeRef.current?.conflictedBytes();
    if (!info || !bytes) return;
    setCopying(true);
    const created = await apiRequest<{ id: string; currentVersionId: string }>("/api/workbooks", {
      method: "POST",
      body: { title: `${info.title} (copy)`.slice(0, APP_CONFIG.workbooks.titleMaxLength) },
    });
    if (created.ok) {
      const saved = await putWorkbook(created.data.id, bytes, created.data.currentVersionId);
      if (saved.ok) {
        window.location.assign(`/w/${created.data.id}`);
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

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/" className={styles.back} aria-label="Back to your workbooks">
          ←
        </Link>
        <h1 className={styles.title} title={info?.title}>
          {info?.title ?? "Opening…"}
        </h1>
        <span className={styles.status} data-status={state.status} role="status" aria-live="polite">
          {STATUS_TEXT[state.status]}
        </span>
        <span className={styles.hint}>Ctrl/⌘ + S to save</span>
      </header>

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
          <span>{state.message} Your changes are still here; press Ctrl/⌘ + S to try again.</span>
        </div>
      ) : null}

      {failed ? (
        <main className="message-page">
          <h1>{state.status === "editor-failed" ? "The editor couldn't start" : "Couldn't open this workbook"}</h1>
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
    </div>
  );
}
