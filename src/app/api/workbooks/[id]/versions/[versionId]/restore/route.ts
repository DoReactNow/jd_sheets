import {
  workbookSchemas as s,
  workbooksController as c,
} from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const POST = route<unknown, undefined, { id: string; versionId: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "edit" },
  handler: c.restoreVersion,
});
