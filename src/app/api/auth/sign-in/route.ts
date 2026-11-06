import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

// Open to every network: a Super Admin may sign in from anywhere (Decision 57).
export const POST = route({
  access: "public",
  network: "sign-in",
  input: s.signInInput,
  handler: c.signIn,
});
