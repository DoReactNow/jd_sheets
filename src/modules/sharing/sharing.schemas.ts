// Input schemas with friendly messages (X-INPUT-01..05).
import { z } from "zod";

export const shareRoleSchema = z.enum(["EDITOR", "COMMENTER", "VIEWER"], {
  error: "Choose Viewer, Commenter or Editor.",
});

export const shareInput = z.object({
  target: z.object(
    {
      type: z.enum(["user", "group"], { error: "Choose a person or a group." }),
      id: z.uuid({ error: "Choose a person or a group from the list." }),
    },
    { error: "Choose a person or a group." },
  ),
  role: shareRoleSchema,
});

export const changeGrantInput = z.object({ role: shareRoleSchema });

export const linkInput = z.object({ role: shareRoleSchema.nullable() });

export const settingsInput = z.object({
  allowDownloadForReaders: z.boolean({ error: "Choose whether readers may download." }),
});

export const shareTargetsInput = z.object({
  q: z
    .string({ error: "Type a name or email." })
    .trim()
    .min(1, { error: "Type a name or email." })
    .max(100, { error: "That search is too long." }),
});

export const transferInput = z.object({
  newOwnerId: z.uuid({ error: "Choose the new owner." }),
});

export type ShareInput = z.output<typeof shareInput>;
