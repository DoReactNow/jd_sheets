import { workbooksController } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const GET = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "read" },
  handler: workbooksController.get,
});
