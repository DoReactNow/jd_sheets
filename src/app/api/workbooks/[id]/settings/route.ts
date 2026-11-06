import { sharingController as c, sharingSchemas as s } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

export const PUT = route({
  access: "authenticated",
  workbook: { param: "id", capability: "share" },
  input: s.settingsInput,
  handler: c.setSettings,
});
