import { z } from "zod";

const targetNumberSchema = z
  .string()
  .min(5)
  .max(60)
  .regex(/^[0-9+\-\s]+$/, "Target number may only contain digits, spaces, '+', or '-'")
  .transform((value) => value.replace(/[\s-]+/g, ""));

export const ppobInquirySchema = z.object({
  body: z.object({
    sku: z.string().min(3).max(60),
    targetNumber: targetNumberSchema
  })
});

export const ppobCreateOrderSchema = z.object({
  body: z.object({
    sku: z.string().min(3).max(60),
    targetNumber: targetNumberSchema,
    idempotencyKey: z.string().min(8).max(120)
  })
});

export const ppobOrderListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
});

export const ppobOrderDetailSchema = z.object({
  params: z.object({
    orderId: z.string().uuid()
  })
});
