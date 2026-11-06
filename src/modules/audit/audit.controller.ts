// HTTP side of the audit module.
import { z } from "zod";
import type { RouteContext } from "@/shared/http/route";
import { isBusinessDate } from "@/shared/time";
import { auditService } from "./audit.service";

const day = z.string().refine(isBusinessDate, { error: "Use a date like 2027-01-31." }).optional();

export const auditListInput = z.object({
  actorId: z.uuid({ error: "Choose a person from the list." }).optional(),
  action: z.string().max(80).optional(),
  from: day,
  to: day,
  before: z.uuid().optional(),
});

export const auditController = {
  async list({ input }: RouteContext<z.output<typeof auditListInput>, Record<string, string>>) {
    return {
      data: await auditService.list({
        actorId: input.actorId,
        action: input.action || undefined,
        fromDay: input.from as never,
        toDay: input.to as never,
        before: input.before,
      }),
    };
  },
};
