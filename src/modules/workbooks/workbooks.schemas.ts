// Input schemas with friendly messages (X-INPUT-01..05).
import { z } from "zod";
import { APP_CONFIG } from "@/shared/config/appConfig";

const MAX = APP_CONFIG.workbooks.titleMaxLength;

export const titleSchema = z
  .string({ error: "Enter a title." })
  .trim()
  .min(1, { error: "Enter a title." })
  .max(MAX, { error: `Titles can be up to ${MAX} characters.` })
  // Control characters (tabs, new lines, invisible codes) are not allowed in titles.
  .refine((value) => !/\p{Cc}/u.test(value), { error: "Titles can't contain special characters." });

export const createWorkbookInput = z.object({
  title: titleSchema.optional(),
});
export type CreateWorkbookInput = z.output<typeof createWorkbookInput>;

/** The version a save is based on, from If-Match: a quoted or bare UUID. */
export const ifMatchSchema = z
  .string({ error: "This save is missing the version it was based on." })
  .transform((value) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, ""))
  .pipe(z.uuid({ error: "This save is missing the version it was based on." }));
