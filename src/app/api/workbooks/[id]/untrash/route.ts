import { workbooksController as c } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const POST = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "own" },
  handler: c.untrash,
});
