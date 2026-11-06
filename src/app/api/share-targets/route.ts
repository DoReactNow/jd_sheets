import { sharingController as c, sharingSchemas as s } from "@/modules/sharing/sharing.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "authenticated",
  input: s.shareTargetsInput,
  handler: c.targets,
});
