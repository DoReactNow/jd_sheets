"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "@/shared/ui/forms.module.css";
import { useApiForm } from "@/shared/ui/useForm";

/** Your own name, email and role (Decision 66). Only the name can be changed here. */
export function ProfileForm({
  displayName,
  email,
  roleName,
}: {
  displayName: string;
  email: string;
  roleName: string;
}) {
  const router = useRouter();
  const form = useApiForm<{ displayName: string }>("/api/me", "PATCH");
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const data = new FormData(event.currentTarget);
    const result = await form.submit({ displayName: data.get("displayName") });
    if (result.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <main className={styles.card}>
      <h1 className={styles.title}>Your profile</h1>
      <p className={styles.muted}>
        Your name is what others see in shared sheets, live editing and history.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="displayName">Name</label>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            defaultValue={displayName}
            maxLength={100}
            className={styles.input}
            onChange={() => setSaved(false)}
            required
          />
          {form.fieldError("displayName") ? (
            <span className={styles.fieldError}>{form.fieldError("displayName")}</span>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input id="email" value={email} readOnly disabled className={styles.input} />
        </div>
        <div className={styles.field}>
          <label htmlFor="role">Role</label>
          <input id="role" value={roleName} readOnly disabled className={styles.input} />
        </div>
        {form.generalError ? <ErrorMessage error={form.generalError} /> : null}
        {saved ? (
          <p className={styles.notice} role="status">
            Saved. Your new name shows everywhere from now on.
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="submit" className="btn btn-primary" disabled={form.busy}>
            {form.busy ? "Saving…" : "Save name"}
          </button>
        </div>
      </form>
      <p className={styles.footer}>
        <Link href="/change-password">Change your password</Link>
      </p>
    </main>
  );
}
