import { workbooksController } from "@/modules/workbooks/workbooks.controller";
import { route } from "@/shared/http/route";

export const GET = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "read" },
  handler: workbooksController.content,
});

// Commenters save comments only, Editors need the lease, Viewers never save: decided by the
// service (P2-ROLE-02..05, P2-LEASE-07).
export const PUT = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "comment" },
  handler: workbooksController.save,
});
