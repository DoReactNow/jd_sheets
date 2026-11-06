// The one email rule (Decision 12): lower-cased, trimmed, and exactly the company domain. Used by every
// path where an email enters the system; the database constraint repeats it (P1-DOMAIN-08).
import { z } from "zod";
import { APP_CONFIG } from "@/shared/config/appConfig";

const DOMAIN = APP_CONFIG.company.allowedEmailDomain;
const escaped = DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// ASCII local part only: no quotes, spaces, extra "@" or look-alike letters.
const ALLOWED = new RegExp(`^[a-z0-9._%+'-]{1,64}@${escaped}$`);

export const EMAIL_DOMAIN_MESSAGE = `Use your @${DOMAIN} email address.`;

export function normalizeEmail(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  return ALLOWED.test(email) && !email.startsWith(".") && !email.includes("..");
}

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .max(254, { error: "That email address is too long." })
  .transform(normalizeEmail)
  .refine((value) => value.length > 0, { error: "Enter your email address." })
  .refine(isAllowedEmail, { error: EMAIL_DOMAIN_MESSAGE });
