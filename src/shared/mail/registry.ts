// The only file that imports a mail driver (architecture rule 8).
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/logger";
import { createFakeMailer, latestFakeMail } from "./drivers/fake";
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
      throw new Error("MAIL_DRIVER=smtp is not available yet; use fake (Decision 47)");
    default:
      throw new Error(`Unknown MAIL_DRIVER "${String(env.MAIL_DRIVER)}"`);
  }
}

/** Test-only (callers check APP_ENV=test first): the newest fake message to an address. */
export function readLatestFakeMail(to: string) {
  return latestFakeMail(to);
}
