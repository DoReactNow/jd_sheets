import { collabController as c } from "@/modules/collab/collab.controller";
import { route } from "@/shared/http/route";

export const POST = route<unknown, undefined, { id: string }>({
  access: "internal",
  handler: c.snapshot,
});
