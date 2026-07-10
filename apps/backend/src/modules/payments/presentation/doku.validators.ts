import { z } from "zod";

export const dokuCreatePaymentSchema = z.object({
  body: z.object({
    orderId: z.string().uuid()
  })
});

export const dokuNotificationSchema = z.object({
  body: z.record(z.unknown())
});

export const dokuStatusSchema = z.object({
  params: z.object({
    referenceId: z.string().min(3).max(120)
  })
});
