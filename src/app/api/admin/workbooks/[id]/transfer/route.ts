import { sharingController as c, sharingSchemas as s } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "workbooks:administer" },
  input: s.transferInput,
  handler: c.transfer,
});
