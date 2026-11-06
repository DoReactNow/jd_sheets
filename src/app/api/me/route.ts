import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "authenticated",
  allowWhilePasswordChangeRequired: true,
  handler: c.me,
});
