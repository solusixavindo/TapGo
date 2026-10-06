import { z } from "zod";
import { PUSH_SOUNDS } from "../infrastructure/FcmClient.js";

export const registerPushTokenSchema = z.object({
  body: z.object({
    token: z.string().trim().min(20).max(4096),
    platform: z.enum(["android", "ios"]),
    deviceId: z.string().trim().min(1).max(120).optional(),
    /** Bunyi pilihan driver; tidak dikirim = pilihan tersimpan tidak diubah. */
    sound: z.enum(PUSH_SOUNDS).optional()
  })
});

export const removePushTokenSchema = z.object({
  body: z.object({
    token: z.string().trim().min(20).max(4096)
  })
});
