import { auditController, auditListInput } from "@/modules/audit/audit.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "audit:view" },
  input: auditListInput,
  handler: auditController.list,
});
