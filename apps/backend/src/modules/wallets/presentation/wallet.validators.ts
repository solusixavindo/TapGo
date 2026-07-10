import { WithdrawalStatus } from "@prisma/client";
import { z } from "zod";

export const walletTransactionQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
});

export const withdrawalRequestSchema = z.object({
  body: z.object({
    amount: z.coerce.number().min(50000),
    bankName: z.string().min(2).max(80),
    bankCode: z.string().min(2).max(24).optional(),
    accountNumber: z.string().min(6).max(40),
    accountHolderName: z.string().min(2).max(120),
    notes: z.string().max(500).optional()
  })
});

export const bankAccountSchema = z.object({
  body: z.object({
    bankName: z.string().min(2).max(80),
    bankCode: z.string().min(2).max(24).optional(),
    accountNumber: z.string().min(6).max(40),
    accountHolderName: z.string().min(2).max(120)
  })
});

export const withdrawalListSchema = z.object({
  query: z.object({
    status: z.nativeEnum(WithdrawalStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
});

export const adminUserWalletSchema = z.object({
  params: z.object({
    userId: z.string().uuid()
  })
});

export const withdrawalActionSchema = z.object({
  params: z.object({
    withdrawalId: z.string().uuid(),
    id: z.string().uuid().optional()
  }),
  body: z.object({
    note: z.string().max(500).optional()
  }).default({})
});

export const withdrawalDetailSchema = z.object({
  params: z.object({
    withdrawalId: z.string().uuid(),
    id: z.string().uuid().optional()
  })
});
