import { z } from "zod";

const ppobCategory = z.enum(["PULSA", "DATA", "PLN_PREPAID", "PLN_POSTPAID", "BPJS", "EWALLET"]);

export const ppobProductsQuerySchema = z.object({
  query: z.object({
    category: ppobCategory.optional()
  })
});

export const ppobPurchaseSchema = z.object({
  body: z.object({
    sku: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Z0-9_]+$/, "sku harus huruf besar/angka/underscore"),
    targetNumber: z.string().trim().min(4).max(40)
  }),
  headers: z.object({}).passthrough()
});

export const ppobHistoryQuerySchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
});

export const ppobReferenceSchema = z.object({
  params: z.object({
    reference: z.string().regex(/^PPB-[A-Z2-9]{10}$/)
  })
});
