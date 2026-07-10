import { MembershipTier } from "@prisma/client";
import { z } from "zod";

export const upgradeMembershipSchema = z.object({
  body: z.object({
    targetTier: z.nativeEnum(MembershipTier),
    paymentReference: z.string().min(3).max(120).optional()
  })
});

export const membershipRulesSchema = z.object({
  params: z.object({
    tier: z.nativeEnum(MembershipTier)
  }),
  body: z.object({
    name: z.string().min(2).max(80).optional(),
    price: z.coerce.number().nonnegative().optional(),
    directBonus: z.coerce.number().nonnegative().optional(),
    activeLevels: z.coerce.number().int().min(0).max(10).optional(),
    isActive: z.boolean().optional(),
    benefits: z.array(z.object({
      level: z.coerce.number().int().min(1).max(10),
      commissionRate: z.coerce.number().min(0).max(100),
      fixedBonus: z.coerce.number().nonnegative(),
      isActive: z.boolean().optional()
    })).max(10).optional()
  })
});

export const createMembershipOrderSchema = z.object({
  body: z.object({
    packageId: z.string().uuid(),
    registrationData: z.record(z.unknown()).optional()
  })
});

export const membershipOrderDetailSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});

export const membershipPaymentSuccessSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    paymentReference: z.string().min(3).max(120).optional()
  }).optional()
});

export const payMembershipOrderSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});
