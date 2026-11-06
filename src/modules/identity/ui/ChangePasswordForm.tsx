"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "@/shared/ui/forms.module.css";
import { useApiForm } from "@/shared/ui/useForm";
import { Brand } from "./SignInForm";

export function ChangePasswordForm({ required }: { required: boolean }) {
  const router = useRouter();
  const form = useApiForm<{ ok: true }>("/api/auth/password");
  const [mismatch, setMismatch] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("newPassword") !== data.get("confirm")) return setMismatch(true);
    const result = await form.submit({
      currentPassword: data.get("currentPassword"),
      newPassword: data.get("newPassword"),
    });
    if (result.ok) {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <main className={styles.card}>
      <Brand />
      <h1 className={styles.title}>Choose a new password</h1>
      {required ? (
        <p className={styles.notice}>Please choose your own password before you continue.</p>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="currentPassword">Current or temporary password</label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            className={styles.input}
          />
          {form.fieldError("currentPassword") ? (
            <span className={styles.fieldError}>{form.fieldError("currentPassword")}</span>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            className={styles.input}
          />
          <span className={styles.hint}>At least 12 characters.</span>
          {form.fieldError("newPassword") ? (
            <span className={styles.fieldError}>{form.fieldError("newPassword")}</span>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="confirm">Repeat the new password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            className={styles.input}
            onChange={() => setMismatch(false)}
          />
          {mismatch ? (
            <span className={styles.fieldError}>The two passwords are different.</span>
          ) : null}
        </div>
        {form.generalError ? <ErrorMessage error={form.generalError} /> : null}
        <div className={styles.actions}>
          <button type="submit" className="btn btn-primary" disabled={form.busy}>
            {form.busy ? "Saving…" : "Save new password"}
          </button>
        </div>
      </form>
    </main>
  );
}
