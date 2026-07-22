import { z } from "zod";

export const ppobProductListSchema = z.object({
  query: z.object({}).default({}),
});

export const ppobCreateTransactionSchema = z.object({
  body: z.object({
    productId: z.string().uuid(),
    clientRequestId: z.string().min(8).max(120),
    destination: z.string().min(8).max(32),
    quotedPrice: z.number().int().positive().optional(),
  }),
});

export const ppobTransactionListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const ppobTransactionDetailSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

export const digiflazzWebhookSchema = z.object({
  headers: z.object({}).passthrough(),
  body: z.unknown(),
});
