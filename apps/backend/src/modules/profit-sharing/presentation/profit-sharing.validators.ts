import { z } from "zod";

export const createProfitSharingPeriodSchema = z.object({
  body: z.object({
    periodMonth: z.coerce.number().int().min(1).max(12),
    periodYear: z.coerce.number().int().min(2024).max(2200),
    netProfitAmount: z.coerce.number().positive().optional(),
    totalPoolAmount: z.coerce.number().positive().optional()
  }).refine((body) => body.netProfitAmount !== undefined || body.totalPoolAmount !== undefined, {
    message: "netProfitAmount is required",
    path: ["netProfitAmount"]
  })
});

export const profitSharingPeriodParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});
