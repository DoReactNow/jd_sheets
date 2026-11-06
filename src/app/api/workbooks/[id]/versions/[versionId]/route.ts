import {
  workbookSchemas as s,
  workbooksController as c,
} from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: "authenticated",
  workbook: { param: "id", capability: "edit" },
  input: s.versionName,
  handler: c.nameVersion,
});
