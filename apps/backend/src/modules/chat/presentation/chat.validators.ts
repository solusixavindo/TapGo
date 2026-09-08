import { z } from "zod";

export const chatSendMessageSchema = z.object({
  params: z.object({
    rideRef: z.string().min(1).max(60)
  }),
  body: z.object({
    message: z.string().min(1).max(1000)
  })
});

export const chatListMessagesSchema = z.object({
  params: z.object({
    rideRef: z.string().min(1).max(60)
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50)
  })
});

export const chatMarkReadSchema = z.object({
  params: z.object({
    rideRef: z.string().min(1).max(60)
  })
});
