import { workbookSchemas, workbooksController } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

// Anyone who can read may ask: a person without edit rights is told VIEW_ONLY and loses any
// lease they still hold (P2-LEASE-09, -10).
export const POST = route({
  access: "authenticated",
  workbook: { param: "id", capability: "read" },
  input: workbookSchemas.lease,
  handler: workbooksController.lease,
});
