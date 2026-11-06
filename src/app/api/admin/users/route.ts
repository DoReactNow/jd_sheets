import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "users:view" },
  input: s.userListInput,
  handler: c.listUsers,
});

export const POST = route({
  access: { permission: "users:create" },
  input: s.createUserInput,
  handler: c.createUser,
});
