import { workbooksController as c } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

type Params = { id: string; versionId: string };

export const POST = route<unknown, undefined, Params>({
  access: "authenticated",
  workbook: { param: "id", capability: "edit" },
  handler: c.restoreVersion,
});
