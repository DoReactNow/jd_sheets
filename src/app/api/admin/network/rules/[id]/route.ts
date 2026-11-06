import { networkController, networkSchemas } from "@/modules/network/network.controller";
import { route } from "@/shared/http/route";

export const PATCH = route({
  access: { permission: "network:manage" },
  input: networkSchemas.update,
  handler: networkController.update,
});

export const DELETE = route<unknown, undefined, { id: string }>({
  access: { permission: "network:manage" },
  handler: networkController.remove,
});
