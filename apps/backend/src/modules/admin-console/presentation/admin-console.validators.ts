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
import { ROLE_REASON_CODES } from "../application/AdminRoleService.js";

const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
};

export const adminListQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    search: z.string().trim().min(1).max(120).optional(),
    package: z.nativeEnum(MembershipTier).optional(),
    status: z.string().trim().min(1).max(40).optional(),
    /// Filter kartu Beranda: login dalam N hari terakhir / daftar dalam N hari
    /// (hari ini = 1) menurut hari kalender WIB.
    activeDays: z.coerce.number().int().min(1).max(90).optional(),
    registeredDays: z.coerce.number().int().min(1).max(90).optional(),
    source: z.enum(["PLAY", "OTHER", "UNKNOWN"]).optional()
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

/// Pengelolaan role oleh pemilik sistem. SUPER_ADMIN_VIP sengaja tidak ada di
/// daftar role yang dapat diberikan: role puncak hanya lahir dari CLI.
export const adminRoleAssignSchema = z.object({
  params: z.object({
    userId: z.string().uuid()
  }),
  body: z.object({
    role: z.enum(["USER", "ADMIN", "SUPER_ADMIN"]),
    reasonCode: z.enum(ROLE_REASON_CODES)
  })
});

export const adminRoleCandidateSchema = z.object({
  query: z.object({
    q: z.string().trim().min(3).max(60)
  })
});

export const adminAuditLogQuerySchema = z.object({
  query: z.object({
    ...paginationQuery,
    action: z.string().trim().min(1).max(120).optional(),
    entityType: z.string().trim().min(1).max(80).optional()
  })
});

export const adminMemberStatusSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    reason: z.string().trim().min(3).max(300)
  })
});
