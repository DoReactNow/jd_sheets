import { sharingController as c, sharingSchemas as s } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

type Params = { id: string; grantId: string };

export const PATCH = route({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  input: s.changeGrantInput,
  handler: c.changeGrant,
});

export const DELETE = route<unknown, undefined, Params>({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  handler: c.removeGrant,
});
