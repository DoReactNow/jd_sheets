import { workbookSchemas, workbooksController } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "authenticated",
  workbook: { param: "id", capability: "read" },
  input: workbookSchemas.releaseLease,
  handler: workbooksController.releaseLease,
});
