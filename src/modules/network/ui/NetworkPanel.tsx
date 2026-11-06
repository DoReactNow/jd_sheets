"use client";

import { useState, type FormEvent } from "react";
import type { FriendlyError } from "@/shared/api/friendlyError";
import { formatInstant, parseInstant } from "@/shared/time";
import styles from "@/shared/ui/admin.module.css";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import { apiSend, useApiData } from "@/shared/ui/useApiData";

interface Rule {
  id: string;
  cidr: string;
  label: string;
  enabled: boolean;
  updatedAt: string;
}

interface Overview {
  rules: Rule[];
  yourIp: string | null;
  blocked: Array<{ id: string; ip: string; method: string; path: string; at: string }>;
  outsideAccess: Array<{
    id: string;
    ip: string | null;
    who: string;
    email: string;
    kind: string;
    at: string;
  }>;
}

export function NetworkPanel({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useApiData<Overview>("/api/admin/network");
  const [actionError, setActionError] = useState<FriendlyError | null>(null);

  async function act(promise: Promise<{ ok: boolean; error?: FriendlyError }>) {
    const result = await promise;
    setActionError(result.ok ? null : (result.error ?? null));
    await reload();
    return result.ok;
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (
      await act(
        apiSend("/api/admin/network/rules", "POST", {
          cidr: form.get("cidr"),
          label: form.get("label"),
          enabled: true,
        }),
      )
    ) {
      formElement.reset();
    }
  }

  return (
    <section>
      <h1 className={styles.heading}>Network access</h1>
      <p className={styles.sub}>
        Only these addresses and ranges can open the app. Your address now:{" "}
        <strong>{data?.yourIp ?? "unknown"}</strong>. A change that would block you is refused.
      </p>
      {actionError ? <ErrorMessage error={actionError} /> : null}
      {actionError?.fieldErrors?.map((f) => (
        <p key={f.field} className={styles.fieldError}>
          {f.message}
        </p>
      ))}
      {canManage ? (
        <form className={styles.toolbar} onSubmit={onAdd}>
          <label>
            Address or range
            <input name="cidr" className={styles.input} placeholder="203.0.113.0/24" required />
          </label>
          <label>
            Label
            <input name="label" className={styles.input} placeholder="Head office" required />
          </label>
          <button type="submit" className="btn btn-primary">
            Add
          </button>
          {data?.yourIp ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                act(
                  apiSend("/api/admin/network/rules", "POST", {
                    cidr: data.yourIp,
                    label: "Added from this computer",
                    enabled: true,
                  }),
                )
              }
            >
              Add my address
            </button>
          ) : null}
        </form>
      ) : null}
      {error ? <ErrorMessage error={error} /> : null}
      <div className={styles.panel}>
        {!data ? (
          <p className={styles.empty}>Loading…</p>
        ) : data.rules.length === 0 ? (
          <p className={styles.empty}>No rules yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Address or range</th>
                <th>Label</th>
                <th>Enabled</th>
                <th>Changed</th>
                {canManage ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    <code>{rule.cidr}</code>
                  </td>
                  <td>{rule.label}</td>
                  <td>
                    {canManage ? (
                      <input
                        type="checkbox"
                        aria-label={`Enable ${rule.label}`}
                        checked={rule.enabled}
                        onChange={(e) =>
                          act(
                            apiSend(`/api/admin/network/rules/${rule.id}`, "PATCH", {
                              enabled: e.target.checked,
                            }),
                          )
                        }
                      />
                    ) : rule.enabled ? (
                      "Yes"
                    ) : (
                      "No"
                    )}
                  </td>
                  <td className={styles.muted}>
                    {formatInstant(parseInstant(rule.updatedAt), "dateTime")}
                  </td>
                  {canManage ? (
                    <td>
                      <div className={styles.row}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            const label = window.prompt("New label", rule.label);
                            if (label)
                              void act(
                                apiSend(`/api/admin/network/rules/${rule.id}`, "PATCH", { label }),
                              );
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            window.confirm(`Remove ${rule.cidr}?`) &&
                            act(apiSend(`/api/admin/network/rules/${rule.id}`, "DELETE"))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <h2 className={styles.heading} style={{ fontSize: 17 }}>
        Recently blocked
      </h2>
      <div className={styles.panel}>
        {!data || data.blocked.length === 0 ? (
          <p className={styles.empty}>Nothing blocked recently.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Address</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {data.blocked.map((row) => (
                <tr key={row.id}>
                  <td className={styles.muted}>
                    {formatInstant(parseInstant(row.at), "dateTime")}
                  </td>
                  <td>
                    <code>{row.ip}</code>
                  </td>
                  <td className={styles.muted}>
                    {row.method} {row.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <h2 className={styles.heading}>Super Admin access from outside</h2>
      <p className={styles.sub}>
        Super Admins may sign in from any network; each time is recorded here and in the audit
        trail.
      </p>
      <div className={styles.panel}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Address</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            {data?.outsideAccess.map((row) => (
              <tr key={row.id}>
                <td>{formatInstant(parseInstant(row.at), "dateTime")}</td>
                <td>
                  {row.who} <span className={styles.muted}>{row.email}</span>
                </td>
                <td>{row.ip ?? "unknown"}</td>
                <td>{row.kind === "sign-in" ? "Signed in" : "Used the app"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.outsideAccess.length === 0 ? <p className={styles.empty}>None yet.</p> : null}
      </div>
    </section>
  );
}
