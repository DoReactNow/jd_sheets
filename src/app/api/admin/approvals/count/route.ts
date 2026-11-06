import { identityController as c } from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({ access: { permission: "users:approve" }, handler: c.countPending });
