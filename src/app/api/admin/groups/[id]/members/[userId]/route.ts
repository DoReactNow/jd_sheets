import { identityController as c } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

type Params = { id: string; userId: string };

export const DELETE = route<unknown, undefined, Params>({
  access: { permission: "groups:manage" },
  handler: c.removeGroupMember,
});
