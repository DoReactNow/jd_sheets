import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "groups:manage" },
  input: s.addMembersInput,
  handler: c.addGroupMembers,
});
