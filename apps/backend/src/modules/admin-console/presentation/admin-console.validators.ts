import {
  CommissionStatus,
  CommissionType,
  MembershipOrderStatus,
  MembershipTier,
  PaymentStatus,
  RewardTransactionStatus,
  WithdrawalStatus
} from "@prisma/client";
import { z } from "zod";

const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
};

export const adminListQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    search: z.string().trim().min(1).max(120).optional(),
    package: z.nativeEnum(MembershipTier).optional(),
    status: z.string().trim().min(1).max(40).optional()
  })
});

export const adminMemberDetailSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});

export const adminPaymentQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    status: z.nativeEnum(PaymentStatus).optional()
  })
});

export const adminInvoiceQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    status: z.nativeEnum(PaymentStatus).optional()
  })
});

export const adminCommissionQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    type: z.nativeEnum(CommissionType).optional(),
    bonusType: z.enum(["sponsor", "level", "reward", "profit_sharing"]).optional()
  })
});

export const adminWalletTransactionSchema = z.object({
  params: z.object({
    userId: z.string().uuid()
  }),
  query: z.object({
    ...paginationQuery
  })
});

export const adminWithdrawalQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    status: z.nativeEnum(WithdrawalStatus).optional()
  })
});

export const adminWithdrawalDetailSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});

export const adminWithdrawalActionSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    note: z.string().max(500).optional()
  }).default({})
});

export const adminOrderQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    status: z.nativeEnum(MembershipOrderStatus).optional()
  })
});

export const adminMemberRequestActionSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    reason: z.string().trim().max(500).optional()
  }).default({})
});

export const adminFounderPlatinumGrantSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(32),
    password: z.string().min(6).max(120),
    founderId: z.string().trim().regex(/^FND-\d{3}$/).optional(),
    email: z.string().trim().email().max(180).optional(),
    sponsorReferralCode: z.string().trim().min(3).max(24).optional(),
    reason: z.string().trim().max(500).optional()
  })
});

export const adminFounderPlatinumDetailSchema = z.object({
  params: z.object({
    founderId: z.string().trim().regex(/^FND-\d{3}$/)
  })
});

export const adminFounderPlatinumStatusSchema = z.object({
  params: z.object({
    founderId: z.string().trim().regex(/^FND-\d{3}$/)
  }),
  body: z.object({
    status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
    reason: z.string().trim().max(500).optional()
  })
});

export const adminFounderChairmanGrantSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(32),
    password: z.string().min(6).max(120),
    email: z.string().trim().email().max(180).optional(),
    reason: z.string().trim().min(3).max(500),
    secureBankAccountReference: z.string().trim().max(120).optional(),
    bankAccount: z.object({
      bankName: z.string().trim().min(2).max(80),
      accountHolderName: z.string().trim().min(2).max(120),
      accountNumber: z.string().trim().min(4).max(40)
    }).optional()
  })
});

export const adminFounderChairmanDetailSchema = z.object({
  params: z.object({
    founderId: z.string().trim().regex(/^FCH-\d{3}$/)
  })
});

export const adminFounderChairmanStatusSchema = z.object({
  params: z.object({
    founderId: z.string().trim().regex(/^FCH-\d{3}$/)
  }),
  body: z.object({
    status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]),
    reason: z.string().trim().max(500).optional()
  })
});

export const adminReportQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    userId: z.string().uuid().optional(),
    type: z.nativeEnum(CommissionType).optional(),
    status: z.nativeEnum(CommissionStatus).optional()
  })
});

export const adminRewardQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    userId: z.string().uuid().optional(),
    status: z.nativeEnum(RewardTransactionStatus).optional()
  })
});

export const adminRewardDetailSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  })
});

export const adminRewardActionSchema = z.object({
  params: z.object({
    id: z.string().uuid()
  }),
  body: z.object({
    reason: z.string().trim().max(500).optional(),
    note: z.string().trim().max(500).optional()
  }).default({})
});

export const adminFinancialReportQuerySchema = z.object({
  query: z.object({
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional()
  })
});

export const adminGenericStatusQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    status: z.string().trim().min(1).max(40).optional()
  })
});
