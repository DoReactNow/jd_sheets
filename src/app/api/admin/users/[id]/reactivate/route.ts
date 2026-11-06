import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route<unknown, undefined, { id: string }>({
  access: { permission: "users:deactivate" },
  handler: c.reactivate,
});
