import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({ access: { permission: "users:approve" }, handler: c.countPending });
