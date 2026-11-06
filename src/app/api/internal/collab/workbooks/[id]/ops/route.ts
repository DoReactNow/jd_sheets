import { collabController as c, collabSchemas as s } from "@/modules/collab/collab.controller";
import { route } from "@/shared/http/route";

export const POST = route({ access: "internal", input: s.appendOps, handler: c.appendOps });
