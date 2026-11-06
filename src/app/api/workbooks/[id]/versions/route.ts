import {
  workbookSchemas as s,
  workbooksController as c,
} from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

// Owner, Editor and Commenter; not Viewer (P2-ROLE-07).
export const GET = route({
  access: "authenticated",
  workbook: { param: "id", capability: "history" },
  input: s.versionList,
  handler: c.versions,
});
