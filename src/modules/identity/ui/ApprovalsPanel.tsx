"use client";

import { useState } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { formatInstant, parseInstant } from "@/shared/time";
import styles from "@/shared/ui/admin.module.css";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";
import type { AdminUserDto } from "../identity.types";

export function ApprovalsPanel({ canApproveSuperAdmin }: { canApproveSuperAdmin: boolean }) {
  const { data, error, reload } = useApiData<{ users: AdminUserDto[] }>("/api/admin/approvals");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<FriendlyError | null>(null);

  async function decide(user: AdminUserDto, action: "approve" | "reject") {
    if (action === "reject" && !window.confirm(`Reject the request from ${user.displayName}?`))
      return;
    const result = await apiSend(
      `/api/admin/approvals/${user.id}/${action}`,
      "POST",
      action === "approve" ? { role: roles[user.id] ?? "MEMBER" } : {},
    );
    setActionError(result.ok ? null : result.error);
    await reload();
  }

  return (
    <section>
      <h1 className={styles.heading}>Approvals</h1>
      <p className={styles.sub}>People who asked for an account, oldest first.</p>
      {actionError ? <ErrorMessage error={actionError} /> : null}
      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.panel}>
        {!data ? (
          <p className={styles.empty}>Loading…</p>
        ) : data.users.length === 0 ? (
          <p className={styles.empty}>No requests waiting.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Asked</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.displayName}{" "}
                    {user.rejectedBefore ? (
                      <span className={styles.status} data-status="REJECTED">
                        Rejected before
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.muted}>{user.email}</td>
                  <td className={styles.muted}>
                    {formatInstant(parseInstant(user.createdAt), "dateTime")}
                  </td>
                  <td>
                    <div className={styles.row}>
                      <select
                        className={styles.select}
                        aria-label={`Role for ${user.displayName}`}
                        value={roles[user.id] ?? "MEMBER"}
                        onChange={(event) => setRoles({ ...roles, [user.id]: event.target.value })}
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                        {canApproveSuperAdmin ? (
                          <option value="SUPER_ADMIN">Super Admin</option>
                        ) : null}
                      </select>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => decide(user, "approve")}
                      >
                        Approve
                      </button>
                      <button type="button" className="btn" onClick={() => decide(user, "reject")}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
