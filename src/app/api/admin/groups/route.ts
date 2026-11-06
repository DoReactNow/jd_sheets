import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "groups:manage" },
  input: s.groupListInput,
  handler: c.listGroups,
});

export const POST = route({
  access: { permission: "groups:manage" },
  input: s.groupInput,
  handler: c.createGroup,
});
