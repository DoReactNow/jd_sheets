"use client";

// Version history (P2-VER-01..04): newest first with who and when (Kolkata time), names, opening
// an old version in view mode, and restoring one (Owner and Editor).
import { useState } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { formatInstant, parseInstant } from "@/shared/time";
import { Dialog, dialogStyles as styles } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";
import type { SavedVersionDto, VersionDto, VersionPageDto } from "../workbooks.types";

const SOURCE: Record<VersionDto["source"], string> = {
  CREATE: "Created",
  SAVE: "Saved",
  AUTOSAVE: "Autosaved",
  IMPORT: "Imported",
  RESTORE: "Restored",
  LIVE_SNAPSHOT: "Live editing",
};

export function VersionHistory({
  workbookId,
  canEdit,
  onClose,
  onRestored,
}: {
  workbookId: string;
  canEdit: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const base = `/api/workbooks/${workbookId}/versions`;
  const { data, error, reload } = useApiData<VersionPageDto>(base);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function restore(version: VersionDto) {
    const result = await apiSend<SavedVersionDto>(`${base}/${version.id}/restore`, "POST");
    if (!result.ok) return setActionError(result.error);
    onRestored();
  }

  async function saveName(version: VersionDto) {
    const result = await apiSend(`${base}/${version.id}`, "PATCH", { name });
    setActionError(result.ok ? null : result.error);
    if (result.ok) setNaming(null);
    await reload();
  }

  return (
    <Dialog title="Version history" onClose={onClose}>
      {error ? <ErrorMessage error={error} /> : null}
      {actionError ? <ErrorMessage error={actionError} /> : null}
      {data && data.items.length === 0 ? <p className={styles.muted}>No versions yet.</p> : null}
      <ul className={styles.list} aria-label="Versions">
        {data?.items.map((v) => (
          <li key={v.id} className={styles.item}>
            <span className={styles.who}>
              <strong>{v.name ?? `Version ${v.number}`}</strong>{" "}
              <span className={styles.muted}>
                {formatInstant(parseInstant(v.createdAt), "dateTime")} · {SOURCE[v.source]}
                {v.restoredFromNumber ? ` from version ${v.restoredFromNumber}` : ""}
                {v.createdBy ? ` · ${v.createdBy.displayName}` : ""}
                {v.contributors.length > 0
                  ? ` · ${v.contributors.map((c) => c.displayName).join(", ")}`
                  : ""}
                {v.current ? " · current" : ""}
              </span>
              {naming === v.id ? (
                <span className={styles.row}>
                  <input
                    className={styles.input}
                    aria-label="Version name"
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void saveName(v)}
                  >
                    Save name
                  </button>
                </span>
              ) : null}
            </span>
            {!v.current ? (
              <a
                className="btn"
                href={`/w/${workbookId}?version=${v.id}`}
                target="_blank"
                rel="noopener"
              >
                Open
              </a>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setNaming(v.id);
                  setName(v.name ?? "");
                }}
              >
                Name
              </button>
            ) : null}
            {canEdit && !v.current ? (
              <button type="button" className="btn" onClick={() => void restore(v)}>
                Restore
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>
        Named versions are kept forever. Restoring adds a new version; nothing is lost.
      </p>
    </Dialog>
  );
}
