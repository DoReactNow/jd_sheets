// Input schemas for the collab routes.
import { z } from "zod";

const uuid = z.uuid({ error: "Please reload the page." });

export const appendOpsInput = z.object({
  baseVersionId: uuid,
  ops: z
    .array(
      z.object({
        seq: z.number().int().positive(),
        userId: uuid,
        clientCommandId: z.string().min(1).max(80),
        commandId: z.string().min(1).max(80),
        step: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(500),
});

export const heartbeatInput = z.object({ editing: z.boolean() });

/** Headers of a snapshot upload: the base version and the contributors. */
export const snapshotHeaders = z.object({
  baseVersionId: uuid,
  contributors: z
    .string()
    .max(5000)
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(uuid).max(200)),
});
