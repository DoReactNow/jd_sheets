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

export const LIST_SCOPES = ["mine", "shared", "recent", "all", "trash"] as const;
export type ListScope = (typeof LIST_SCOPES)[number];

export const listWorkbooksInput = z.object({
  scope: z.enum(LIST_SCOPES, { error: "Choose a list." }).default("mine"),
  q: z.string().trim().max(MAX, { error: "That search is too long." }).optional(),
  sort: z.enum(["updated", "title"], { error: "Choose a sort." }).default("updated"),
  dir: z.enum(["asc", "desc"], { error: "Choose a direction." }).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListWorkbooksInput = z.output<typeof listWorkbooksInput>;

/** A random id per editor page (tab), for the edit lease (Decision 52). */
export const tabIdSchema = z
  .string({ error: "Please reload the page." })
  .regex(/^[A-Za-z0-9_-]{8,64}$/, { error: "Please reload the page." });

export const leaseInput = z.object({
  tabId: tabIdSchema,
  takeOver: z.boolean().optional().default(false),
});
export type LeaseInput = z.output<typeof leaseInput>;

export const releaseLeaseInput = z.object({ tabId: tabIdSchema });
