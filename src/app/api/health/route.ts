import { systemController } from "@/modules/system/system.controller";
import { route } from "@/shared/http/route";

// Not behind the network rules: container health checks call it (Decision 46).
export const GET = route({ access: "public", network: false, handler: systemController.health });
