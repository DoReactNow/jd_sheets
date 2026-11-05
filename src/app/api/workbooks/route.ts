import { workbooksController } from "@/modules/workbooks/workbooks.controller";
import { createWorkbookInput } from "@/modules/workbooks/workbooks.schemas";
import { route } from "@/shared/http/route";

export const GET = route({ access: "authenticated", handler: workbooksController.list });

export const POST = route({
  access: { permission: "workbooks:create" },
  input: createWorkbookInput,
  handler: workbooksController.create,
});
