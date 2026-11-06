import { workbookSchemas, workbooksController } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const GET = route({ access: "authenticated", handler: workbooksController.list });

export const POST = route({
  access: { permission: "workbooks:create" },
  input: workbookSchemas.create,
  handler: workbooksController.create,
});
