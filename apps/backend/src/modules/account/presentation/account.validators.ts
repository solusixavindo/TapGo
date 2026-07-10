import { z } from "zod";

export const accountDeletionRequestSchema = z.object({
  body: z.object({
    reason: z.string().trim().max(1000).optional()
  }).default({})
});

