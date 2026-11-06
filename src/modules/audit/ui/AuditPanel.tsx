"use client";

import { useState } from "react";
import { formatInstant, parseInstant } from "@/shared/time";
import styles from "@/shared/ui/admin.module.css";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { useApiData } from "@/shared/ui/useApiData";

interface AuditEvent {
  id: string;
  at: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: { id: string; name: string; email: string } | null;
  actorKind: string;
  ip: string | null;
  details: Record<string, unknown>;
}

/** "user.password_reset" → "User password reset". */
const readable = (action: string) => {
  const text = action.replace(/[._]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function AuditPanel() {
  const [filter, setFilter] = useState({ action: "", from: "", to: "" });
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const { data, error } = useApiData<{ events: AuditEvent[]; actions: string[] }>(
    `/api/admin/audit${query ? `?${query}` : ""}`,
  );

  return (
    <section>
      <h1 className={styles.heading}>Audit trail</h1>
      <p className={styles.sub}>Who did what, and when (India time). Read only.</p>
      <div className={styles.toolbar}>
        <label>
          Action
          <select
            className={styles.select}
            value={filter.action}
            onChange={(e) => setFilter({ ...filter, action: e.target.value })}
          >
            <option value="">Any</option>
            {data?.actions.map((action) => (
              <option key={action} value={action}>
                {readable(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            className={styles.input}
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            className={styles.input}
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
          />
        </label>
      </div>
      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.panel}>
        {!data ? (
          <p className={styles.empty}>Loading…</p>
        ) : data.events.length === 0 ? (
          <p className={styles.empty}>Nothing recorded for these filters.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id}>
                  <td className={styles.muted}>
                    {formatInstant(parseInstant(event.at), "dateTime")}
                  </td>
                  <td>
                    {event.actor ? event.actor.name : event.actorKind === "SYSTEM" ? "System" : "—"}
                  </td>
                  <td>{readable(event.action)}</td>
                  <td className={styles.muted}>{event.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
