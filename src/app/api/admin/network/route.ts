import { networkController } from "@/modules/network/network.controller";
import { route } from "@/shared/http/route";

export const GET = route({
  access: { permission: "network:view" },
  handler: networkController.overview,
});
