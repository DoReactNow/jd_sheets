import { sharingController as c, sharingSchemas as s } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

export const GET = route<unknown, undefined, { id: string }>({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  handler: c.get,
});

export const PUT = route({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  input: s.shareInput,
  handler: c.share,
});
