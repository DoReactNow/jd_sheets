// The only file that imports a mail driver (architecture rule 8).
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/logger";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { createFakeMailer, latestFakeMail } from "./drivers/fake";
import { createSmtpMailer } from "./drivers/smtp";
import type { Mailer } from "./mailer";

let cached: Mailer | undefined;

export function getMailer(): Mailer {
  if (cached) return cached;
  const env = getEnv();
  switch (env.MAIL_DRIVER) {
    case "fake":
      cached = createFakeMailer({ logToConsole: env.APP_ENV === "development", logger });
      return cached;
    case "smtp":
      // parseEnv guarantees every SMTP setting is present when MAIL_DRIVER=smtp.
      cached = createSmtpMailer({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT!,
        user: env.SMTP_USER!,
        password: env.SMTP_PASSWORD!,
        from: env.MAIL_FROM!,
        requireTls: env.APP_ENV === "production",
        timeoutMs: APP_CONFIG.mail.timeoutSeconds * 1000,
      });
      return cached;
    default:
      throw new Error(`Unknown MAIL_DRIVER "${String(env.MAIL_DRIVER)}"`);
  }
}

/** Test-only (callers check APP_ENV=test first): the newest fake message to an address. */
export function readLatestFakeMail(to: string) {
  return latestFakeMail(to);
}
