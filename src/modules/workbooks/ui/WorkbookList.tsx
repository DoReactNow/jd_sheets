"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import type { WorkbookDto } from "../workbooks.types";
import { formatChanged, formatSize } from "./format";
import styles from "./WorkbookList.module.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: FriendlyError }
  | { kind: "ready"; workbooks: WorkbookDto[] };

/** Home: the person's workbooks, newest change first, and "New workbook". */
export function WorkbookList() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<FriendlyError | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<WorkbookDto[]>("/api/workbooks");
    setState(
      result.ok
        ? { kind: "ready", workbooks: result.data }
        : { kind: "error", error: result.error },
    );
  }, []);

  useEffect(() => {
    // Load once on arrival; the list refreshes when the person comes back to the tab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function createWorkbook() {
    setCreating(true);
    setCreateError(null);
    const result = await apiRequest<WorkbookDto>("/api/workbooks", { method: "POST", body: {} });
    if (result.ok) {
      router.push(`/w/${result.data.id}`);
      return;
    }
    setCreating(false);
    setCreateError(result.error);
  }

  return (
    <section aria-labelledby="workbooks-heading">
      <div className={styles.toolbar}>
        <h1 id="workbooks-heading" className={styles.heading}>
          Your workbooks
        </h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={createWorkbook}
          disabled={creating}
        >
          {creating ? "Creating…" : "New workbook"}
        </button>
      </div>
      {createError ? <ErrorMessage error={createError} /> : null}

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
      ) : state.workbooks.length === 0 ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <p className={styles.emptyTitle}>No workbooks yet</p>
          <p className={styles.muted}>Create your first workbook to get started.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={createWorkbook}
            disabled={creating}
          >
            Create your first workbook
          </button>
        </div>
      ) : (
        <div className={styles.panel}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Last changed</th>
                <th scope="col" className={styles.num}>
                  Size
                </th>
              </tr>
            </thead>
            <tbody>
              {state.workbooks.map((workbook) => (
                <tr key={workbook.id}>
                  <td>
                    <Link href={`/w/${workbook.id}`} className={styles.title}>
                      <span className={styles.icon} aria-hidden="true">
                        ▦
                      </span>
                      {workbook.title}
                    </Link>
                  </td>
                  <td className={styles.muted}>{formatChanged(workbook.updatedAt)}</td>
                  <td className={`${styles.muted} ${styles.num}`}>
                    {formatSize(workbook.sizeBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
