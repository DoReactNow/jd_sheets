import {
  workbookSchemas as s,
  workbooksController as c,
} from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const GET = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "read" },
  handler: c.get,
});

// Rename: Owner and Editor (P2-ROLE-08).
export const PATCH = route({
  access: "authenticated",
  workbook: { param: "id", capability: "edit" },
  input: s.rename,
  handler: c.rename,
});

// Delete for good: the Owner, from the Trash only (P2-ROLE-09).
export const DELETE = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "own" },
  handler: c.deleteForever,
});
