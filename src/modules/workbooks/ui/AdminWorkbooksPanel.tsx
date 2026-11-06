"use client";

// Administrator workbook tools (P2-ADMINWB-01..05): every workbook's title, owner, size and last
// change (never content), ownership transfer, and an audited, view-only open with a reason.
import { useState } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import styles from "@/shared/ui/admin.module.css";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";
import type { AdminWorkbookDto } from "../workbooks.types";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { formatChanged, formatSize } from "./format";

interface UserRow {
  id: string;
  email: string;
  displayName: string;
}

export function AdminWorkbooksPanel() {
  const [q, setQ] = useState("");
  const [ownerStatus, setOwnerStatus] = useState("");
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (ownerStatus) query.set("ownerStatus", ownerStatus);
  const { data, error, reload } = useApiData<{ workbooks: AdminWorkbookDto[] }>(
    `/api/admin/workbooks?${query.toString()}`,
  );
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [transferring, setTransferring] = useState<AdminWorkbookDto | null>(null);
  const [userQ, setUserQ] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);

  async function open(w: AdminWorkbookDto) {
    const reason = window.prompt(
      `Why do you need to open “${w.title}”? This is recorded in the audit trail.`,
    );
    if (!reason) return;
    const result = await apiSend<{ grant: string; title: string }>(
      `/api/admin/workbooks/${w.id}/open`,
      "POST",
      { reason },
    );
    if (!result.ok) return setActionError(result.error);
    window.open(
      `/w/${w.id}?admin=${result.data.grant}&title=${encodeURIComponent(result.data.title)}`,
      "_blank",
      "noopener",
    );
  }

  async function findUsers(text: string) {
    setUserQ(text);
    if (text.trim().length < 2) return setUsers([]);
    const result = await apiSend<{ users: UserRow[] }>(
      `/api/admin/users?q=${encodeURIComponent(text)}&status=ACTIVE`,
      "GET",
    );
    if (result.ok) setUsers(result.data.users);
  }

  async function transfer(newOwner: UserRow) {
    if (!transferring) return;
    const result = await apiSend(`/api/admin/workbooks/${transferring.id}/transfer`, "POST", {
      newOwnerId: newOwner.id,
    });
    setActionError(result.ok ? null : result.error);
    setTransferring(null);
    setUsers([]);
    setUserQ("");
    await reload();
  }

  return (
    <section>
      <h1 className={styles.heading}>Workbooks</h1>
      <p className={styles.sub}>
        Every workbook in {APP_CONFIG.product.name}. Content is never shown here; opening one is
        recorded.
      </p>
      {error ? <ErrorMessage error={error} /> : null}
      {actionError ? <ErrorMessage error={actionError} /> : null}
      <div className={styles.toolbar}>
        <label>
          Title
          <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          Owner
          <select
            className={styles.select}
            value={ownerStatus}
            onChange={(e) => setOwnerStatus(e.target.value)}
          >
            <option value="">Anyone</option>
            <option value="ACTIVE">Active people</option>
            <option value="DEACTIVATED">Deactivated people</option>
          </select>
        </label>
      </div>
      {transferring ? (
        <div className={styles.toolbar}>
          <label>
            New owner of “{transferring.title}”
            <input
              className={styles.input}
              placeholder="Name or email"
              value={userQ}
              onChange={(e) => void findUsers(e.target.value)}
            />
          </label>
          {users.map((u) => (
            <button key={u.id} type="button" className="btn" onClick={() => void transfer(u)}>
              {u.displayName}
            </button>
          ))}
          <button type="button" className="btn" onClick={() => setTransferring(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Owner</th>
              <th>Size</th>
              <th>Last change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.workbooks.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.title} {w.trashedAt ? <span className={styles.muted}>(in Trash)</span> : null}
                </td>
                <td>
                  {w.owner ? w.owner.displayName : "—"}
                  {w.owner && !w.owner.active ? (
                    <span className={styles.muted}> · deactivated</span>
                  ) : null}
                </td>
                <td>{formatSize(w.sizeBytes)}</td>
                <td>{formatChanged(w.updatedAt)}</td>
                <td className={styles.row}>
                  <button type="button" className="btn" onClick={() => setTransferring(w)}>
                    Transfer
                  </button>
                  <button type="button" className="btn" onClick={() => void open(w)}>
                    Open as administrator
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.workbooks.length === 0 ? <p className={styles.empty}>No workbooks match.</p> : null}
      </div>
    </section>
  );
}
