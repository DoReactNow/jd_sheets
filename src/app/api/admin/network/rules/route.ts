import { networkController, networkSchemas } from "@/modules/network/network.controller";
import { route } from "@/shared/http/route";

export const POST = route({
  access: { permission: "network:manage" },
  input: networkSchemas.create,
  handler: networkController.create,
});
