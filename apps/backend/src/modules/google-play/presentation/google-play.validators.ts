import { z } from "zod";

export const verifyGooglePlayPurchaseSchema = z.object({
  body: z.object({
    productId: z.string().min(3).max(120),
    purchaseToken: z.string().min(10).max(4096),
    clientRequestId: z.string().uuid(),
  }).strict(),
});
