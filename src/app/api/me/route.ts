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

// Your own name, from the Profile page (Decision 66).
export const PATCH = route({
  access: "authenticated",
  input: s.renameMeInput,
  handler: c.renameMe,
});
