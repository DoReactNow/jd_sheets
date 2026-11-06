"use client";

// The Share dialog (P2-SHARE-*, P2-LINK-*): people and groups with a role, the company link, and
// whether Viewers and Commenters may download. Only the Owner opens it.
import { useEffect, useState } from "react";
import { apiRequest } from "@/shared/api/client";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { Dialog, dialogStyles as styles } from "@/shared/ui/Dialog";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { ShareRoleCode, SharingDto, ShareTargetsDto } from "../sharing.types";

const ROLES: Array<{ value: ShareRoleCode; label: string }> = [
  { value: "VIEWER", label: "Viewer" },
  { value: "COMMENTER", label: "Commenter" },
  { value: "EDITOR", label: "Editor" },
];

type Target = { type: "user" | "group"; id: string; label: string };

export function ShareDialog({
  workbookId,
  title,
  onClose,
}: {
  workbookId: string;
  title: string;
  onClose: () => void;
}) {
  const base = `/api/workbooks/${workbookId}`;
  const { data, error, reload } = useApiData<SharingDto>(`${base}/shares`);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ShareTargetsDto | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [role, setRole] = useState<ShareRoleCode>("VIEWER");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || target) return;
    const timer = setTimeout(async () => {
      const result = await apiRequest<ShareTargetsDto>(
        `/api/share-targets?q=${encodeURIComponent(q)}`,
      );
      if (result.ok) setFound(result.data);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, target]);

  async function act(promise: Promise<{ ok: boolean; error?: FriendlyError }>) {
    const result = await promise;
    setActionError(result.ok ? null : (result.error ?? null));
    await reload();
    return result.ok;
  }

  async function share() {
    if (!target) return;
    if (
      await act(
        apiSend(`${base}/shares`, "PUT", { target: { type: target.type, id: target.id }, role }),
      )
    ) {
      setTarget(null);
      setQuery("");
      setFound(null);
    }
  }

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/w/${workbookId}`;

  return (
    <Dialog title={`Share “${title}”`} onClose={onClose}>
      {error ? <ErrorMessage error={error} /> : null}
      {actionError ? <ErrorMessage error={actionError} /> : null}

      <div className={styles.section}>
        <h3>Add people or groups</h3>
        <div className={styles.row}>
          <div className={styles.grow}>
            <input
              className={styles.input}
              aria-label="Name, email or group"
              placeholder="Name, email or group"
              value={target ? target.label : query}
              onChange={(e) => {
                setTarget(null);
                setQuery(e.target.value);
              }}
            />
            {!target && found && query.trim().length >= 2 ? (
              <ul className={styles.suggestions} aria-label="Matches">
                {found.users.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setTarget({ type: "user", id: u.id, label: u.displayName })}
                    >
                      {u.displayName} <span className={styles.muted}>{u.email}</span>
                    </button>
                  </li>
                ))}
                {found.groups.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setTarget({ type: "group", id: g.id, label: g.name })}
                    >
                      {g.name} <span className={styles.muted}>group · {g.memberCount} people</span>
                    </button>
                  </li>
                ))}
                {found.users.length + found.groups.length === 0 ? (
                  <li className={styles.muted}>No active colleague or group matches.</li>
                ) : null}
              </ul>
            ) : null}
          </div>
          <select
            className={styles.select}
            aria-label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as ShareRoleCode)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" disabled={!target} onClick={share}>
            Share
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <h3>People with access</h3>
        <ul className={styles.list}>
          {data?.owner ? (
            <li className={styles.item}>
              <span className={styles.who}>
                {data.owner.displayName} <span className={styles.muted}>{data.owner.email}</span>
              </span>
              <span className={styles.muted}>Owner</span>
            </li>
          ) : null}
          {data?.grants.map((g) => (
            <li key={g.id} className={styles.item}>
              <span className={styles.who}>
                {g.target.type === "user" ? (
                  <>
                    {g.target.displayName} <span className={styles.muted}>{g.target.email}</span>
                    {!g.target.active ? <span className={styles.muted}> · inactive</span> : null}
                  </>
                ) : (
                  <>
                    {g.target.name}{" "}
                    <span className={styles.muted}>group · {g.target.memberCount} people</span>
                  </>
                )}
              </span>
              <select
                className={styles.select}
                aria-label={`Role for ${g.target.type === "user" ? g.target.displayName : g.target.name}`}
                value={g.role}
                onChange={(e) =>
                  void act(apiSend(`${base}/shares/${g.id}`, "PATCH", { role: e.target.value }))
                }
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                onClick={() => void act(apiSend(`${base}/shares/${g.id}`, "DELETE"))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.section}>
        <h3>Company link</h3>
        <div className={styles.row}>
          <select
            className={styles.select}
            aria-label="Company link"
            value={data?.linkRole ?? ""}
            onChange={(e) =>
              void act(
                apiSend(`${base}/link`, "PUT", {
                  role: e.target.value === "" ? null : e.target.value,
                }),
              )
            }
          >
            <option value="">Off: only the people above</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                Anyone at {APP_CONFIG.company.legalName} with the link: {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
        <p className={styles.muted}>The link still needs sign-in on an allowed network.</p>
      </div>

      <div className={styles.section}>
        <label className={styles.row}>
          <input
            type="checkbox"
            checked={data?.allowDownloadForReaders ?? true}
            onChange={(e) =>
              void act(
                apiSend(`${base}/settings`, "PUT", { allowDownloadForReaders: e.target.checked }),
              )
            }
          />
          Viewers and Commenters may download and export
        </label>
      </div>
    </Dialog>
  );
}
