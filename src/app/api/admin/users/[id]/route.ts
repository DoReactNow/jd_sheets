import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route<unknown, undefined, { id: string }>({
  access: { permission: "users:view" },
  handler: c.getUser,
});

export const PATCH = route({
  access: { permission: "users:edit" },
  input: s.updateUserInput,
  handler: c.updateUser,
});
