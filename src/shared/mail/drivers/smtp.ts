// The "smtp" mailer (Decisions 13, 60): Gmail on port 465 with an app password. Errors are
// rebuilt from scratch so no password, credential encoding or message text can reach a log
// (P4-MAIL-02). Only src/shared/mail/registry.ts imports this file.
import nodemailer from "nodemailer";
import type { Mailer } from "../mailer";

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  /** Google shows app passwords in groups of four with spaces; the spaces are removed. */
  password: string;
  from: string;
  /** On in production: never send over a connection without TLS. */
  requireTls: boolean;
  timeoutMs: number;
}

/** Port 465 is TLS from the first byte; any other port must upgrade with STARTTLS. */
const IMPLICIT_TLS_PORT = 465;

export class MailSendError extends Error {
  constructor(
    message: string,
    readonly reason: "auth" | "unreachable" | "refused",
  ) {
    super(message);
    this.name = "MailSendError";
  }
}

function safeError(error: unknown): MailSendError {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "UNKNOWN";
  const status = typeof e.responseCode === "number" ? ` ${e.responseCode}` : "";
  if (code === "EAUTH") {
    return new MailSendError(
      `The mail server refused the sign-in (EAUTH${status}); check SMTP_USER and the app password`,
      "auth",
    );
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(code)) {
    return new MailSendError(`Could not reach the mail server (${code})`, "unreachable");
  }
  return new MailSendError(`The mail server refused the message (${code}${status})`, "refused");
}

export function createSmtpMailer(settings: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === IMPLICIT_TLS_PORT,
    requireTLS: settings.requireTls,
    auth: { user: settings.user, pass: settings.password.replace(/\s+/g, "") },
    connectionTimeout: settings.timeoutMs,
    greetingTimeout: settings.timeoutMs,
    socketTimeout: settings.timeoutMs,
    logger: false,
    debug: false,
  });
  return {
    driver: "smtp",
    async send(message) {
      try {
        await transport.sendMail({
          from: settings.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      } catch (error) {
        throw safeError(error);
      }
    },
  };
}
