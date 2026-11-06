"use client";

// Home (P2-LIST-*, P2-TRASH-*): My workbooks, Shared with me, Recent and Trash, with title search,
// sort and "Load more"; New workbook and Import. The list, search and sort live in the address, so
// they survive navigating away and pressing Back (X-LIST-03).
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import { toFriendlyError, type FriendlyError } from "@/shared/api/friendlyError";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import type { WorkbookDto, WorkbookPageDto } from "../workbooks.types";
import { formatChanged, formatSize } from "./format";
import styles from "./WorkbookList.module.css";

type Scope = "mine" | "shared" | "recent" | "trash";
const TABS: Array<{ scope: Scope; label: string }> = [
  { scope: "mine", label: "My workbooks" },
  { scope: "shared", label: "Shared with me" },
  { scope: "recent", label: "Recent" },
  { scope: "trash", label: "Trash" },
];
const ROLE_TEXT: Record<string, string> = {
  OWNER: "Owner",
  EDITOR: "Editor",
  COMMENTER: "Commenter",
  VIEWER: "Viewer",
};
const EMPTY: Record<Scope, string> = {
  mine: "Create your first workbook to get started.",
  shared: "Workbooks colleagues share with you appear here.",
  recent: "Workbooks you open appear here.",
  trash: `Workbooks in the Trash are deleted for good after ${APP_CONFIG.workbooks.trashDays} days.`,
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: FriendlyError }
  | { kind: "ready"; items: WorkbookDto[]; nextCursor: string | null };

export function WorkbookList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = (TABS.find((t) => t.scope === params.get("list"))?.scope ?? "mine") as Scope;
  const q = params.get("q") ?? "";
  const sort = params.get("sort") === "title" ? "title" : "updated";
  const [search, setSearch] = useState(q);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const setQuery = useCallback(
    (next: Record<string, string>) => {
      const merged = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (
          value === "" ||
          (key === "list" && value === "mine") ||
          (key === "sort" && value === "updated")
        ) {
          merged.delete(key);
        } else merged.set(key, value);
      }
      const text = merged.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(
    async (cursor?: string) => {
      const query = new URLSearchParams({ scope, sort });
      if (q) query.set("q", q);
      if (cursor) query.set("cursor", cursor);
      const result = await apiRequest<WorkbookPageDto>(`/api/workbooks?${query.toString()}`);
      if (!result.ok) return setState({ kind: "error", error: result.error });
      setState((current) => ({
        kind: "ready",
        items:
          cursor && current.kind === "ready"
            ? [...current.items, ...result.data.items]
            : result.data.items,
        nextCursor: result.data.nextCursor,
      }));
    },
    [scope, sort, q],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Search as the person types, a moment after they stop.
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => setQuery({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search, q, setQuery]);

  async function createWorkbook() {
    setBusy(true);
    setActionError(null);
    const result = await apiRequest<WorkbookDto>("/api/workbooks", { method: "POST", body: {} });
    if (result.ok) return router.push(`/w/${result.data.id}`);
    setBusy(false);
    setActionError(result.error);
  }

  async function importFile(file: File) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch("/api/workbooks/import", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "x-file-name": encodeURIComponent(file.name),
          "content-type": "application/octet-stream",
        },
        body: file,
      });
      const body: unknown = await response.json().catch(() => undefined);
      if (response.ok) return router.push(`/w/${(body as { data: { id: string } }).data.id}`);
      setActionError(toFriendlyError({ status: response.status, body }));
    } catch {
      setActionError(toFriendlyError({ networkError: true }));
    }
    setBusy(false);
  }

  async function act(path: string, method: string) {
    const result = await apiRequest(path, { method });
    setActionError(result.ok ? null : result.error);
    await load();
  }

  return (
    <section aria-labelledby="workbooks-heading">
      <div className={styles.toolbar}>
        <h1 id="workbooks-heading" className={styles.heading}>
          Your workbooks
        </h1>
        <div className={styles.buttons}>
          <button
            type="button"
            className="btn"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={APP_CONFIG.workbooks.importExtensions.map((e) => `.${e}`).join(",")}
            aria-label="Import a file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={createWorkbook}
            disabled={busy}
          >
            {busy ? "Working…" : "New workbook"}
          </button>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Lists">
        {TABS.map((tab) => (
          <button
            key={tab.scope}
            type="button"
            role="tab"
            aria-selected={tab.scope === scope}
            className={styles.tab}
            onClick={() => setQuery({ list: tab.scope })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          aria-label="Search titles"
          placeholder="Search titles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {scope !== "recent" ? (
          <select
            className={styles.select}
            aria-label="Sort"
            value={sort}
            onChange={(e) => setQuery({ sort: e.target.value })}
          >
            <option value="updated">Last changed</option>
            <option value="title">Title</option>
          </select>
        ) : null}
      </div>
      {actionError ? <ErrorMessage error={actionError} /> : null}

      {state.kind === "loading" ? (
        <p className={styles.muted} aria-live="polite">
          Loading your workbooks…
        </p>
      ) : state.kind === "error" ? (
        <div className={styles.panel}>
          <ErrorMessage error={state.error} />
          <button type="button" className="btn" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : state.items.length === 0 ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.emptyTitle}>
            {q ? "Nothing matches your search" : "Nothing here yet"}
          </p>
          <p className={styles.muted}>{q ? "Try other words." : EMPTY[scope]}</p>
          {scope === "mine" && !q ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={createWorkbook}
              disabled={busy}
            >
              Create your first workbook
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.panel}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">
                  {scope === "recent"
                    ? "Opened"
                    : scope === "trash"
                      ? "Moved to Trash"
                      : "Last changed"}
                </th>
                <th scope="col">{scope === "mine" || scope === "trash" ? "Size" : "Owner"}</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((w) => (
                <tr key={w.id}>
                  <td>
                    {scope === "trash" ? (
                      <span className={styles.title}>{w.title}</span>
                    ) : (
                      <Link href={`/w/${w.id}`} className={styles.title}>
                        <span className={styles.icon} aria-hidden="true">
                          ▦
                        </span>
                        {w.title}
                      </Link>
                    )}
                  </td>
                  <td className={styles.muted}>
                    {formatChanged(
                      scope === "recent" && w.openedAt
                        ? w.openedAt
                        : scope === "trash" && w.trashedAt
                          ? w.trashedAt
                          : w.updatedAt,
                    )}
                  </td>
                  <td className={styles.muted}>
                    {scope === "mine" || scope === "trash"
                      ? formatSize(w.sizeBytes)
                      : `${w.owner?.displayName ?? "—"} · ${ROLE_TEXT[w.role] ?? ""}`}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      {scope === "trash" ? (
                        <>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void act(`/api/workbooks/${w.id}/untrash`, "POST")}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete “${w.title}” for good? This can't be undone.`,
                                )
                              ) {
                                void act(`/api/workbooks/${w.id}`, "DELETE");
                              }
                            }}
                          >
                            Delete for good
                          </button>
                        </>
                      ) : w.role === "OWNER" ? (
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Move ${w.title} to Trash`}
                          onClick={() => void act(`/api/workbooks/${w.id}/trash`, "POST")}
                        >
                          Move to Trash
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.nextCursor ? (
            <div className={styles.more}>
              <button type="button" className="btn" onClick={() => void load(state.nextCursor!)}>
                Load more
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
