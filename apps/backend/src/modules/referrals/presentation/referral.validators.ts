import { z } from "zod";

export const claimReferralSchema = z.object({
  body: z.object({
    sponsorCode: z.string().min(4).max(24),
    triggerType: z.string().min(3).max(80).default("REFERRAL_JOIN"),
    triggerId: z.string().min(3).max(120).optional(),
    baseAmount: z.coerce.number().nonnegative().default(0)
  })
});

export const referralTreeSchema = z.object({
  query: z.object({
    maxLevel: z.coerce.number().int().min(1).max(10).default(10)
  })
});

export const referralUplinkSchema = z.object({
  query: z.object({
    maxLevel: z.coerce.number().int().min(1).max(10).default(10)
  })
});

export const referralDownlineSchema = z.object({
  query: z.object({
    maxLevel: z.coerce.number().int().min(1).max(10).default(10),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
});

export const referralDepthSchema = z.object({
  query: z.object({
    maxLevel: z.coerce.number().int().min(1).max(10).default(10)
  })
});

export const commissionHistorySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
});
