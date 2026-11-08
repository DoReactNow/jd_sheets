"use client";

import { useState, type FormEvent } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { formatInstant, parseInstant } from "@/shared/time";
import styles from "@/shared/ui/admin.module.css";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";
import type { AdminUserDto } from "../identity.types";

interface Permissions {
  create: boolean;
  edit: boolean;
  deactivate: boolean;
  reset: boolean;
  superAdmins: boolean;
}

const STATUS_TEXT: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_APPROVAL: "Pending",
  REJECTED: "Rejected",
  DEACTIVATED: "Deactivated",
};

export function UsersPanel({ me, can }: { me: string; can: Permissions }) {
  const [filter, setFilter] = useState({ status: "", role: "", q: "" });
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const { data, error, reload } = useApiData<{ users: AdminUserDto[] }>(
    `/api/admin/users${query ? `?${query}` : ""}`,
  );
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const roleOptions = (
    <>
      <option value="MEMBER">Member</option>
      <option value="ADMIN">Admin</option>
      {can.superAdmins ? <option value="SUPER_ADMIN">Super Admin</option> : null}
    </>
  );

  async function act<T>(
    promise: Promise<{ ok: true; data: T } | { ok: false; error: FriendlyError }>,
  ) {
    const result = await promise;
    setActionError(result.ok ? null : result.error);
    await reload();
    return result;
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await act(
      apiSend<{ temporaryPassword: string; user: AdminUserDto }>("/api/admin/users", "POST", {
        email: form.get("email"),
        displayName: form.get("displayName"),
        role: form.get("role"),
      }),
    );
    if (result.ok) {
      setSecret({ who: result.data.user.email, password: result.data.temporaryPassword });
      setCreating(false);
    }
  }

  async function resetPassword(user: AdminUserDto) {
    if (
      !window.confirm(
        `Set a temporary password for ${user.displayName}? They will be signed out everywhere.`,
      )
    )
      return;
    const result = await act(
      apiSend<{ temporaryPassword: string }>(`/api/admin/users/${user.id}/reset-password`, "POST"),
    );
    if (result.ok) setSecret({ who: user.email, password: result.data.temporaryPassword });
  }

  async function rename(user: AdminUserDto) {
    const next = window.prompt(`New name for ${user.email}`, user.displayName);
    if (next === null || next.trim() === user.displayName) return;
    await act(apiSend(`/api/admin/users/${user.id}`, "PATCH", { displayName: next }));
  }

  const manageable = (user: AdminUserDto) => user.roleKey !== "SUPER_ADMIN" || can.superAdmins;

  return (
    <section>
      <h1 className={styles.heading}>Users</h1>
      <p className={styles.sub}>
        Everyone with an account. Accounts are never deleted; deactivate them instead.
      </p>
      {secret ? (
        <div className={styles.secret} role="status">
          Temporary password for {secret.who}: <code>{secret.password}</code> — give it to them in
          person. They must change it when they sign in.{" "}
          <button type="button" className="btn" onClick={() => setSecret(null)}>
            Done
          </button>
        </div>
      ) : null}
      {actionError ? <ErrorMessage error={actionError} /> : null}
      {actionError?.fieldErrors?.map((f) => (
        <p key={f.field} className={styles.fieldError}>
          {f.message}
        </p>
      ))}

      <div className={styles.toolbar}>
        <label>
          Search
          <input
            className={styles.input}
            value={filter.q}
            placeholder="Name or email"
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          />
        </label>
        <label>
          Status
          <select
            className={styles.select}
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          >
            <option value="">Any</option>
            {Object.entries(STATUS_TEXT).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select
            className={styles.select}
            value={filter.role}
            onChange={(e) => setFilter({ ...filter, role: e.target.value })}
          >
            <option value="">Any</option>
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        {can.create ? (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(!creating)}>
            Create user
          </button>
        ) : null}
      </div>

      {creating ? (
        <form className={styles.panel} style={{ padding: 16 }} onSubmit={onCreate}>
          <div className={styles.toolbar}>
            <label>
              Name
              <input name="displayName" className={styles.input} required />
            </label>
            <label>
              Email
              <input name="email" type="email" className={styles.input} required />
            </label>
            <label>
              Role
              <select name="role" className={styles.select} defaultValue="MEMBER">
                {roleOptions}
              </select>
            </label>
            <button type="submit" className="btn btn-primary">
              Create with a temporary password
            </button>
          </div>
        </form>
      ) : null}

      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.panel}>
        {!data ? (
          <p className={styles.empty}>Loading…</p>
        ) : data.users.length === 0 ? (
          <p className={styles.empty}>No one matches.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td className={styles.muted}>{user.email}</td>
                  <td>
                    {can.edit && manageable(user) && user.status === "ACTIVE" && user.id !== me ? (
                      <select
                        className={styles.select}
                        aria-label={`Role of ${user.displayName}`}
                        value={user.roleKey ?? "MEMBER"}
                        onChange={(e) =>
                          act(
                            apiSend(`/api/admin/users/${user.id}`, "PATCH", {
                              role: e.target.value,
                            }),
                          )
                        }
                      >
                        {roleOptions}
                        {!can.superAdmins && user.roleKey === "SUPER_ADMIN" ? (
                          <option value="SUPER_ADMIN">Super Admin</option>
                        ) : null}
                      </select>
                    ) : (
                      (user.roleName ?? "—")
                    )}
                  </td>
                  <td>
                    <span className={styles.status} data-status={user.status}>
                      {STATUS_TEXT[user.status] ?? user.status}
                    </span>
                  </td>
                  <td className={styles.muted}>
                    {user.lastSignInAt
                      ? formatInstant(parseInstant(user.lastSignInAt), "dateTime")
                      : "Never"}
                  </td>
                  <td>
                    <div className={styles.row}>
                      {can.edit && manageable(user) ? (
                        <button type="button" className="btn" onClick={() => rename(user)}>
                          Rename
                        </button>
                      ) : null}
                      {can.reset && manageable(user) && user.status === "ACTIVE" ? (
                        <button type="button" className="btn" onClick={() => resetPassword(user)}>
                          Reset password
                        </button>
                      ) : null}
                      {can.deactivate &&
                      manageable(user) &&
                      user.id !== me &&
                      user.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            window.confirm(`Deactivate ${user.displayName}?`) &&
                            act(apiSend(`/api/admin/users/${user.id}/deactivate`, "POST"))
                          }
                        >
                          Deactivate
                        </button>
                      ) : null}
                      {can.deactivate && manageable(user) && user.status === "DEACTIVATED" ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            act(apiSend(`/api/admin/users/${user.id}/reactivate`, "POST"))
                          }
                        >
                          Reactivate
                        </button>
                      ) : null}
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
