import { z } from "zod";

export const midtransNotificationSchema = z.object({
  body: z.object({
    order_id: z.string().min(3).max(80),
    transaction_status: z.string().min(3).max(40),
    transaction_id: z.string().min(3).max(120).optional(),
    fraud_status: z.string().min(2).max(40).optional(),
    status_code: z.string().min(2).max(8).optional(),
    gross_amount: z.string().min(1).max(32).optional(),
    signature_key: z.string().min(20).max(256).optional(),
    payment_type: z.string().min(2).max(60).optional(),
    transaction_time: z.string().min(6).max(60).optional()
  }).passthrough()
});
