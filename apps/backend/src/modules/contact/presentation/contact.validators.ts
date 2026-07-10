import { z } from "zod";

export const contactMessageSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    contact: z.string().trim().min(5).max(180),
    category: z.string().trim().min(2).max(80),
    message: z.string().trim().min(5).max(2000)
  })
});

