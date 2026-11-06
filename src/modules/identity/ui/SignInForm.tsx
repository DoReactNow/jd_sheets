"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "@/shared/ui/forms.module.css";
import { useApiForm } from "@/shared/ui/useForm";
import { safeNextPath } from "./safeNextPath";

export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const form = useApiForm<{ mustChangePassword: boolean }>("/api/auth/sign-in");
  const [status, setStatus] = useState<"pending" | "rejected" | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await form.submit({ email: data.get("email"), password: data.get("password") });
    if (result.ok) {
      router.replace(result.data.mustChangePassword ? "/change-password" : safeNextPath(next));
      router.refresh();
      return;
    }
    if (result.error.code === "ACCOUNT_PENDING") setStatus("pending");
    if (result.error.code === "ACCOUNT_REJECTED") setStatus("rejected");
  }

  if (status) {
    return (
      <main className={styles.card} data-testid={`status-${status}`}>
        <Brand />
        <h1 className={styles.title}>
          {status === "pending" ? "Waiting for approval" : "Request not approved"}
        </h1>
        <p className={styles.muted}>{form.error?.message}</p>
        <button type="button" className="btn" onClick={() => setStatus(null)}>
          Back to sign in
        </button>
      </main>
    );
  }

  return (
    <main className={styles.card}>
      <Brand />
      <h1 className={styles.title}>Sign in</h1>
      <p className={styles.muted}>Use your @{APP_CONFIG.company.allowedEmailDomain} account.</p>
      <form onSubmit={onSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            className={styles.input}
            required
          />
          {form.fieldError("email") ? (
            <span className={styles.fieldError}>{form.fieldError("email")}</span>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className={styles.input}
            required
          />
          {form.fieldError("password") ? (
            <span className={styles.fieldError}>{form.fieldError("password")}</span>
          ) : null}
        </div>
        {form.generalError ? <ErrorMessage error={form.generalError} /> : null}
        <div className={styles.actions}>
          <button type="submit" className="btn btn-primary" disabled={form.busy}>
            {form.busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
      <p className={styles.footer}>Forgot your password? Ask an admin to reset it.</p>
      <p className={styles.footer}>
        New here? <Link href="/request-access">Request access</Link>
      </p>
    </main>
  );
}

export function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.logo} aria-hidden="true">
        ▦
      </span>
      {APP_CONFIG.product.name}
    </div>
  );
}
