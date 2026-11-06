import { identityController as c } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route<unknown, undefined, { id: string }>({
  access: { permission: "users:approve" },
  handler: c.reject,
});
