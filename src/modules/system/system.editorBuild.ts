// Reads public/editor/build-info.json, written by scripts/editor-build.mjs (P0-EDIT-03).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { EditorBuild } from "./system.schemas";

const buildInfoSchema = z.object({
  gridcraft: z.object({ tag: z.string(), commit: z.string() }),
  patches: z.array(z.string()),
});

export async function readEditorBuild(
  file = path.join(process.cwd(), "public/editor/build-info.json"),
): Promise<EditorBuild | null> {
  try {
    const info = buildInfoSchema.parse(JSON.parse(await readFile(file, "utf8")));
    return {
      gridcraftTag: info.gridcraft.tag,
      gridcraftCommit: info.gridcraft.commit,
      patches: info.patches,
    };
  } catch {
    return null;
  }
}
