import { z } from "zod";

export const registerPushTokenSchema = z.object({
  body: z.object({
    token: z.string().trim().min(20).max(4096),
    platform: z.enum(["android", "ios"]),
    deviceId: z.string().trim().min(1).max(120).optional()
  })
});

export const removePushTokenSchema = z.object({
  body: z.object({
    token: z.string().trim().min(20).max(4096)
  })
});
