import { identityController as c } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const DELETE = route<unknown, undefined, { id: string; userId: string }>({
  access: { permission: "groups:manage" },
  handler: c.removeGroupMember,
});
