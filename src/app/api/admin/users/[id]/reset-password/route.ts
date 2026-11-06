import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "users:reset-password" },
  input: s.resetPasswordInput,
  handler: c.resetPassword,
});
