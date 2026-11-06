import { sharingController as c, sharingSchemas as s } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  input: s.changeGrantInput,
  handler: c.changeGrant,
});

export const DELETE = route<unknown, undefined, { id: string; grantId: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  handler: c.removeGrant,
});
