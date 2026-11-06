import { collabController as c } from "@/modules/collab/collab.controller";
import { route } from "@/shared/http/route";

// Anyone who can read may connect; the service enforces the role per change (P3-ROLE-*).
export const POST = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "read" },
  handler: c.token,
});
