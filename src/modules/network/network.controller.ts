// HTTP side of the network module.
import type { z } from "zod";
import { AppError } from "@/shared/errors/AppError";
import type { RouteContext } from "@/shared/http/route";
import { createRuleInput, updateRuleInput } from "./network.schemas";
import { networkService, requestIp } from "./network.service";

export const networkSchemas = { create: createRuleInput, update: updateRuleInput };

function principalOf<I, P>(context: RouteContext<I, P>) {
  if (!context.principal) throw new AppError("UNAUTHENTICATED");
  return context.principal;
}

export const networkController = {
  async overview({ request }: RouteContext<undefined, Record<string, string>>) {
    return {
      data: {
        rules: await networkService.list(),
        yourIp: requestIp(request.headers),
        blocked: await networkService.recentBlocked(),
        outsideAccess: await networkService.recentOutsideAccess(),
      },
    };
  },
  async create(context: RouteContext<z.output<typeof createRuleInput>, Record<string, string>>) {
    return {
      status: 201,
      data: await networkService.create(
        principalOf(context),
        requestIp(context.request.headers),
        context.input,
      ),
    };
  },
  async update(context: RouteContext<z.output<typeof updateRuleInput>, { id: string }>) {
    return {
      data: await networkService.update(
        principalOf(context),
        requestIp(context.request.headers),
        context.params.id,
        context.input,
      ),
    };
  },
  async remove(context: RouteContext<undefined, { id: string }>) {
    await networkService.remove(
      principalOf(context),
      requestIp(context.request.headers),
      context.params.id,
    );
    return { data: { ok: true } };
  },
};
