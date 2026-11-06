// The shape of the health and diagnostics responses, shared by the service, controller and tests.
import { z } from "zod";
import { SERVICE_STATES } from "./system.types";

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(SERVICE_STATES),
  version: z.string(),
  time: z.iso.datetime(),
});
export type Health = z.infer<typeof healthSchema>;

export const editorBuildSchema = z.object({
  gridcraftTag: z.string(),
  gridcraftCommit: z.string(),
  patches: z.array(z.string()),
});
export type EditorBuild = z.infer<typeof editorBuildSchema>;

export const diagnosticsSchema = healthSchema.extend({
  collab: z.enum(SERVICE_STATES),
  worker: z.object({ state: z.enum(SERVICE_STATES), lastBeatAt: z.iso.datetime().nullable() }),
  editor: editorBuildSchema.nullable(),
});
export type Diagnostics = z.infer<typeof diagnosticsSchema>;
