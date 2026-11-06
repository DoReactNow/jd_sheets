"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { ErrorMessage } from "@/shared/ui/ErrorMessage";
import styles from "@/shared/ui/forms.module.css";
import { useApiForm } from "@/shared/ui/useForm";
import { Brand } from "./SignInForm";

type Step = "email" | "code" | "details" | "done";

export function RequestAccess() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [ticket, setTicket] = useState("");
  const [wait, setWait] = useState(0);
  const request = useApiForm<{ ok: true }>("/api/auth/sign-up/request");
  const verify = useApiForm<{ ticket: string }>("/api/auth/sign-up/verify");
  const complete = useApiForm<{ ok: true }>("/api/auth/sign-up/complete");

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode(address: string) {
    const result = await request.submit({ email: address });
    if (result.ok) {
      setEmail(address);
      setStep("code");
      setWait(APP_CONFIG.otp.resendAfterSeconds);
    }
  }

  async function onEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode(String(new FormData(event.currentTarget).get("email") ?? ""));
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const result = await verify.submit({ email, code });
    if (result.ok) {
      setTicket(result.data.ticket);
      setStep("details");
    }
  }

  async function onDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirm")) {
      complete.setError(null);
      return alertMismatch();
    }
    const result = await complete.submit({
      ticket,
      displayName: data.get("displayName"),
      password: data.get("password"),
    });
    if (result.ok) setStep("done");
  }

  const [mismatch, setMismatch] = useState(false);
  const alertMismatch = () => setMismatch(true);

  return (
    <main className={styles.card}>
      <Brand />
      {step === "email" ? (
        <>
          <h1 className={styles.title}>Request access</h1>
          <p className={styles.muted}>
            We&apos;ll email you a code. Use your @{APP_CONFIG.company.allowedEmailDomain} address.
          </p>
          <form onSubmit={onEmail} noValidate>
            <div className={styles.field}>
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                className={styles.input}
                defaultValue={email}
              />
              {request.fieldError("email") ? (
                <span className={styles.fieldError}>{request.fieldError("email")}</span>
              ) : null}
            </div>
            {request.generalError ? <ErrorMessage error={request.generalError} /> : null}
            <div className={styles.actions}>
              <button type="submit" className="btn btn-primary" disabled={request.busy}>
                {request.busy ? "Sending…" : "Send code"}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {step === "code" ? (
        <>
          <h1 className={styles.title}>Enter your code</h1>
          <p className={styles.muted}>
            If {email} can be used, we have sent a 6-digit code. It works for{" "}
            {APP_CONFIG.otp.validMinutes} minutes.
          </p>
          <form onSubmit={onCode} noValidate>
            <div className={styles.field}>
              <label htmlFor="code">Code</label>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                className={`${styles.input} ${styles.otp}`}
              />
              {verify.fieldError("code") ? (
                <span className={styles.fieldError}>{verify.fieldError("code")}</span>
              ) : null}
            </div>
            {verify.generalError ? <ErrorMessage error={verify.generalError} /> : null}
            <div className={styles.actions}>
              <button type="submit" className="btn btn-primary" disabled={verify.busy}>
                {verify.busy ? "Checking…" : "Continue"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={wait > 0 || request.busy}
                onClick={() => sendCode(email)}
              >
                {wait > 0 ? `Send a new code in ${wait} s` : "Send a new code"}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {step === "details" ? (
        <>
          <h1 className={styles.title}>Your details</h1>
          <p className={styles.muted}>{email}</p>
          <form onSubmit={onDetails} noValidate>
            <div className={styles.field}>
              <label htmlFor="displayName">Your name</label>
              <input
                id="displayName"
                name="displayName"
                autoComplete="name"
                className={styles.input}
              />
              {complete.fieldError("displayName") ? (
                <span className={styles.fieldError}>{complete.fieldError("displayName")}</span>
              ) : null}
            </div>
            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                className={styles.input}
              />
              <span className={styles.hint}>At least 12 characters.</span>
              {complete.fieldError("password") ? (
                <span className={styles.fieldError}>{complete.fieldError("password")}</span>
              ) : null}
            </div>
            <div className={styles.field}>
              <label htmlFor="confirm">Repeat the password</label>
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
            {complete.generalError ? <ErrorMessage error={complete.generalError} /> : null}
            <div className={styles.actions}>
              <button type="submit" className="btn btn-primary" disabled={complete.busy}>
                {complete.busy ? "Sending…" : "Request access"}
              </button>
            </div>
          </form>
        </>
      ) : null}

      {step === "done" ? (
        <div data-testid="request-sent">
          <h1 className={styles.title}>Request sent</h1>
          <p className={styles.muted}>
            Thanks. An admin will approve your account soon. Sign in again later.
          </p>
          <Link className="btn btn-primary" href="/sign-in">
            Back to sign in
          </Link>
        </div>
      ) : null}

      {step !== "done" ? (
        <p className={styles.footer}>
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      ) : null}
    </main>
  );
}
