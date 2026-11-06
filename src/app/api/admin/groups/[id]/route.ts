import {
  identityController as c,
  identitySchemas as s,
} from "@/modules/identity/identity.controller";
import { sharingController } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

export const GET = route<unknown, undefined, { id: string }>({
  access: { permission: "groups:manage" },
  handler: c.getGroup,
});

export const PATCH = route({
  access: { permission: "groups:manage" },
  input: s.groupInput,
  handler: c.renameGroup,
});

// Deleting a group also removes its shares (Decision 52), so the sharing module coordinates it.
export const DELETE = route<unknown, undefined, { id: string }>({
  access: { permission: "groups:manage" },
  handler: sharingController.deleteGroup,
});
