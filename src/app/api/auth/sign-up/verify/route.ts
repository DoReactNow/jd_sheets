import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: "public",
  input: s.signupVerifyInput,
  handler: c.signupVerify,
});
