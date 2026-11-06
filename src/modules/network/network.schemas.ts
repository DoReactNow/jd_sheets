import { z } from "zod";

const label = z
  .string({ error: 'Enter a label, like "Head office".' })
  .trim()
  .min(1, { error: 'Enter a label, like "Head office".' })
  .max(100, { error: "Labels can be up to 100 characters." });

const cidr = z
  .string({ error: "Enter an address or range." })
  .trim()
  .min(1, { error: "Enter an address or range." })
  .max(60, { error: "Enter an address or range, like 203.0.113.0/24." });

export const createRuleInput = z.object({ cidr, label, enabled: z.boolean().default(true) });
export const updateRuleInput = z
  .object({ cidr: cidr.optional(), label: label.optional(), enabled: z.boolean().optional() })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: "Nothing to change.",
  });
