import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route<unknown, { role: "SUPER_ADMIN" | "ADMIN" | "MEMBER" }, { id: string }>({
  access: { permission: "users:approve" },
  input: s.approveInput,
  handler: c.approve,
});
