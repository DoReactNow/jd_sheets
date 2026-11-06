"use client";

// Groups (P2-GROUP-01..05): create, rename, members, and delete with a warning when shares use it
// (Decision 52).
import { useState } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import styles from "@/shared/ui/admin.module.css";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";

interface Group {
  id: string;
  name: string;
  memberCount: number;
}
interface Detail {
  group: Group;
  members: Array<{ id: string; email: string; displayName: string; status: string }>;
  sharedWorkbooks: Array<{ id: string; title: string; role: string }>;
}
interface UserRow {
  id: string;
  email: string;
  displayName: string;
}

export function GroupsPanel() {
  const { data, error, reload } = useApiData<{ groups: Group[] }>("/api/admin/groups");
  const [selected, setSelected] = useState<string | null>(null);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [name, setName] = useState("");

  async function create() {
    const result = await apiSend<Group>("/api/admin/groups", "POST", { name });
    setActionError(result.ok ? null : result.error);
    if (result.ok) {
      setName("");
      setSelected(result.data.id);
    }
    await reload();
  }

  return (
    <section>
      <h1 className={styles.heading}>Groups</h1>
      <p className={styles.sub}>
        Share a workbook with a group to give all its active members the same role.
      </p>
      {error ? <ErrorMessage error={error} /> : null}
      {actionError ? <ErrorMessage error={actionError} /> : null}
      <div className={styles.toolbar}>
        <label>
          New group
          <input
            className={styles.input}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!name.trim()}
          onClick={() => void create()}
        >
          Create
        </button>
      </div>
      <div className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Members</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.groups.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.memberCount}</td>
                <td>
                  <button type="button" className="btn" onClick={() => setSelected(g.id)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.groups.length === 0 ? <p className={styles.empty}>No groups yet.</p> : null}
      </div>
      {selected ? (
        <GroupDetail
          key={selected}
          id={selected}
          onChanged={reload}
          onDeleted={() => {
            setSelected(null);
            void reload();
          }}
        />
      ) : null}
    </section>
  );
}

function GroupDetail({
  id,
  onChanged,
  onDeleted,
}: {
  id: string;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const base = `/api/admin/groups/${id}`;
  const { data, reload } = useApiData<Detail>(base);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<UserRow[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(promise: Promise<{ ok: boolean; error?: FriendlyError }>) {
    const result = await promise;
    setActionError(result.ok ? null : (result.error ?? null));
    await reload();
    await onChanged();
    return result;
  }

  async function search(text: string) {
    setQ(text);
    if (text.trim().length < 2) return setFound([]);
    const result = await apiSend<{ users: UserRow[] }>(
      `/api/admin/users?q=${encodeURIComponent(text)}&status=ACTIVE`,
      "GET",
    );
    if (result.ok) setFound(result.data.users);
  }

  async function remove() {
    const result = await apiSend(`${base}${confirmDelete ? "?confirm=1" : ""}`, "DELETE");
    if (result.ok) return onDeleted();
    if (result.error.code === "GROUP_IN_USE") setConfirmDelete(true);
    setActionError(result.error);
  }

  if (!data) return null;
  return (
    <div className={styles.panel} style={{ padding: 16 }}>
      <div className={styles.toolbar}>
        {rename === null ? (
          <h2 style={{ margin: 0 }}>{data.group.name}</h2>
        ) : (
          <input
            className={styles.input}
            aria-label="Group name"
            value={rename}
            onChange={(e) => setRename(e.target.value)}
          />
        )}
        {rename === null ? (
          <button type="button" className="btn" onClick={() => setRename(data.group.name)}>
            Rename
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if ((await act(apiSend(base, "PATCH", { name: rename }))).ok) setRename(null);
            }}
          >
            Save
          </button>
        )}
        <button type="button" className="btn" onClick={() => void remove()}>
          {confirmDelete ? "Delete group and its shares" : "Delete group"}
        </button>
      </div>
      {actionError ? <ErrorMessage error={actionError} /> : null}
      {confirmDelete && data.sharedWorkbooks.length > 0 ? (
        <p className={styles.sub}>
          Shared with this group: {data.sharedWorkbooks.map((w) => w.title).join(", ")}. Deleting
          removes these shares.
        </p>
      ) : null}
      <div className={styles.toolbar}>
        <label>
          Add people
          <input
            className={styles.input}
            placeholder="Name or email"
            value={q}
            onChange={(e) => void search(e.target.value)}
          />
        </label>
      </div>
      {found.length > 0 ? (
        <ul>
          {found.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFound([]);
                  setQ("");
                  void act(apiSend(`${base}/members`, "POST", { userIds: [u.id] }));
                }}
              >
                Add {u.displayName} ({u.email})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.members.map((m) => (
            <tr key={m.id}>
              <td>
                {m.displayName} <span className={styles.muted}>{m.email}</span>
              </td>
              <td>
                <span className={styles.status} data-status={m.status}>
                  {m.status === "ACTIVE" ? "Active" : "Deactivated"}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void act(apiSend(`${base}/members/${m.id}`, "DELETE"))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
