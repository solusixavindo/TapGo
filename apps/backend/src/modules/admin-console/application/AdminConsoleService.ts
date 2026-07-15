import {
  CommissionType,
  CommissionStatus,
  MembershipOrderStatus,
  MembershipTier,
  PaymentStatus,
  Prisma,
  PrismaClient,
  RewardTransactionStatus,
  WalletTransactionType
} from "@prisma/client";
import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { hashPassword } from "../../../core/security/passwordHasher.js";
import { normalizePhoneNumber, phoneLookupVariants } from "../../../core/security/phone.js";

type PageInput = {
  page: number;
  pageSize: number;
};

type MemberListInput = PageInput & {
  search?: string;
  package?: MembershipTier;
  status?: string;
};

type PaymentListInput = PageInput & {
  status?: PaymentStatus;
};

type CommissionListInput = PageInput & {
  type?: CommissionType;
  bonusType?: "sponsor" | "level" | "reward" | "profit_sharing";
};

type DateRangeInput = PageInput & {
  dateFrom?: Date;
  dateTo?: Date;
  userId?: string;
};

type DateRangeOnlyInput = {
  dateFrom?: Date;
  dateTo?: Date;
};

type BonusReportInput = DateRangeInput & {
  type?: CommissionType;
  status?: CommissionStatus;
};

type RewardListInput = DateRangeInput & {
  status?: RewardTransactionStatus;
};

type FounderPlatinumGrantInput = {
  actorId: string;
  fullName: string;
  phone: string;
  password: string;
  founderId?: string;
  email?: string;
  sponsorReferralCode?: string;
  reason?: string;
};

type FounderChairmanGrantInput = {
  actorId: string;
  fullName: string;
  phone: string;
  password: string;
  email?: string;
  reason: string;
  secureBankAccountReference?: string;
  bankAccount?: {
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
  };
};

type FounderProgramStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

type FounderPlatinumStatusInput = {
  actorId: string;
  founderId: string;
  status: FounderProgramStatus;
  reason?: string;
};

type FounderChairmanStatusInput = FounderPlatinumStatusInput;

const sponsorTypes: CommissionType[] = ["SPONSOR_BONUS", "BASIC_SPONSOR_BONUS"];
const levelTypes: CommissionType[] = ["LEVEL_BONUS", "LEVEL_COMMISSION"];
const rewardTypes: CommissionType[] = ["REWARD_BONUS"];
const profitSharingTypes: CommissionType[] = ["PROFIT_SHARING", "PROFIT_SHARING_BONUS"];

export class AdminConsoleService {
  constructor(private readonly prisma: PrismaClient) {}

  async grantFounderPlatinum(input: FounderPlatinumGrantInput) {
    const normalizedPhone = normalizePhoneNumber(input.phone);
    const passwordHash = await hashPassword(input.password);
    const sponsorReferralCode = input.sponsorReferralCode?.trim().toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const activeFounderCount = await tx.founderProgramGrant.count({
        where: {
          founderRole: "FOUNDER_PLATINUM",
          revokedAt: null
        }
      });

      if (activeFounderCount >= 10) {
        throw new AppError(
          "Founder Platinum grant limit has been reached",
          StatusCodes.CONFLICT,
          "FOUNDER_PLATINUM_LIMIT_REACHED"
        );
      }

      const existingUser = await tx.user.findFirst({
        where: {
          OR: [
            { phone: { in: phoneLookupVariants(normalizedPhone) } },
            ...(input.email ? [{ email: input.email }] : [])
          ]
        },
        select: { id: true }
      });

      if (existingUser) {
        throw new AppError(
          "Founder Platinum can only be granted to a new user account",
          StatusCodes.CONFLICT,
          "FOUNDER_PLATINUM_USER_ALREADY_EXISTS"
        );
      }

      const platinum = await tx.membership.findUnique({
        where: { tier: "PLATINUM" },
        select: { id: true, tier: true, name: true }
      });

      if (!platinum) {
        throw new AppError("Platinum membership package is unavailable", StatusCodes.CONFLICT, "PLATINUM_PACKAGE_NOT_FOUND");
      }

      const sponsor = sponsorReferralCode
        ? await tx.user.findUnique({
          where: { referralCode: sponsorReferralCode },
          select: { id: true, referralCode: true }
        })
        : null;

      if (sponsorReferralCode && !sponsor) {
        throw new AppError("Sponsor referral code is invalid", StatusCodes.BAD_REQUEST, "SPONSOR_NOT_FOUND");
      }

      const now = new Date();
      const referralCode = input.founderId?.trim().toUpperCase() ?? await this.generateFounderReferralCode(tx);
      const existingReferralCode = await tx.user.findUnique({
        where: { referralCode },
        select: { id: true }
      });

      if (existingReferralCode) {
        throw new AppError("Founder ID is already used", StatusCodes.CONFLICT, "FOUNDER_ID_ALREADY_USED");
      }

      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          ...(input.email ? { email: input.email } : {}),
          phone: normalizedPhone,
          passwordHash,
          role: "USER",
          status: "ACTIVE",
          referralCode,
          membershipId: platinum.id
        },
        select: { id: true, fullName: true, email: true, phone: true, referralCode: true, membershipId: true }
      });

      await tx.wallet.create({
        data: {
          userId: user.id,
          balance: new Prisma.Decimal(0),
          cashBalance: new Prisma.Decimal(0),
          ppobBalance: new Prisma.Decimal(0),
          currency: "IDR"
        }
      });

      if (sponsor) {
        await tx.referral.create({
          data: {
            sponsorId: sponsor.id,
            userId: user.id,
            metadata: {
              source: "founder_platinum_admin_grant",
              sponsorReferralCode
            }
          }
        });

        const sponsorAncestors = await tx.referralLevel.findMany({
          where: { descendantId: sponsor.id },
          select: { ancestorId: true, level: true },
          orderBy: { level: "asc" }
        });

        await tx.referralLevel.createMany({
          data: [
            { ancestorId: sponsor.id, descendantId: user.id, level: 1 },
            ...sponsorAncestors
              .filter((ancestor) => ancestor.level + 1 <= 10)
              .map((ancestor) => ({
                ancestorId: ancestor.ancestorId,
                descendantId: user.id,
                level: ancestor.level + 1
              }))
          ],
          skipDuplicates: true
        });
      }

      const userMembership = await tx.userMembership.create({
        data: {
          userId: user.id,
          membershipId: platinum.id,
          status: "ACTIVE",
          founderRole: "FOUNDER_PLATINUM",
          activeAt: now,
          metadata: {
            source: "FOUNDER_PLATINUM",
            founderRole: "FOUNDER_PLATINUM",
            founderId: referralCode,
            grantedBy: input.actorId,
            grantedAt: now.toISOString(),
            reason: input.reason ?? null,
            noInvoice: true,
            noPayment: true,
            noRevenueRecognition: true,
            noAutomaticPpobBenefit: true
          }
        },
        include: { membership: true }
      });

      const grant = await tx.founderProgramGrant.create({
        data: {
          userId: user.id,
          membershipId: platinum.id,
          userMembershipId: userMembership.id,
          founderRole: "FOUNDER_PLATINUM",
          grantedBy: input.actorId,
          ...(input.reason ? { reason: input.reason } : {}),
          metadata: {
            sponsorReferralCode: sponsor?.referralCode ?? null,
            founderId: referralCode,
            activeFounderCountBeforeGrant: activeFounderCount,
            noInvoice: true,
            noPayment: true,
            noRevenueRecognition: true,
            noAutomaticPpobBenefit: true
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "FOUNDER_PLATINUM_GRANTED",
          entityType: "FOUNDER_PROGRAM_GRANT",
          entityId: grant.id,
          metadata: {
            targetUserId: user.id,
            founderRole: "FOUNDER_PLATINUM",
            founderId: referralCode,
            membershipId: platinum.id,
            sponsorReferralCode: sponsor?.referralCode ?? null,
            reason: input.reason ?? null
          }
        }
      });

      return {
        user,
        userMembership,
        founderGrant: grant
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  async grantFounderChairman(input: FounderChairmanGrantInput) {
    const normalizedPhone = normalizePhoneNumber(input.phone);
    const passwordHash = await hashPassword(input.password);
    const founderId = "FCH-001";
    const reason = input.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const existingChairman = await tx.founderProgramGrant.findFirst({
        where: { founderRole: "FOUNDER_CHAIRMAN" },
        select: { id: true }
      });

      if (existingChairman) {
        throw new AppError(
          "Founder Chairman already exists",
          StatusCodes.CONFLICT,
          "FOUNDER_CHAIRMAN_ALREADY_EXISTS"
        );
      }

      const existingUser = await tx.user.findFirst({
        where: {
          OR: [
            { phone: { in: phoneLookupVariants(normalizedPhone) } },
            ...(input.email ? [{ email: input.email }] : [])
          ]
        },
        select: { id: true }
      });

      if (existingUser) {
        throw new AppError(
          "Founder Chairman can only be granted to a new verified user account",
          StatusCodes.CONFLICT,
          "FOUNDER_CHAIRMAN_USER_ALREADY_EXISTS"
        );
      }

      const platinum = await tx.membership.findUnique({
        where: { tier: "PLATINUM" },
        select: { id: true, tier: true, name: true }
      });

      if (!platinum) {
        throw new AppError("Platinum membership package is unavailable", StatusCodes.CONFLICT, "PLATINUM_PACKAGE_NOT_FOUND");
      }

      const existingReferralCode = await tx.user.findUnique({
        where: { referralCode: founderId },
        select: { id: true }
      });

      if (existingReferralCode) {
        throw new AppError("Founder Chairman ID is already used", StatusCodes.CONFLICT, "FOUNDER_CHAIRMAN_ALREADY_EXISTS");
      }

      const now = new Date();
      const bankAccount = input.bankAccount
        ? {
          bankName: input.bankAccount.bankName,
          accountHolderName: input.bankAccount.accountHolderName,
          accountNumber: input.bankAccount.accountNumber,
          source: "FOUNDER_CHAIRMAN_SECURE_INPUT"
        }
        : undefined;
      const bankAccountMasked = this.maskBankAccount(bankAccount);

      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          ...(input.email ? { email: input.email } : {}),
          phone: normalizedPhone,
          passwordHash,
          role: "USER",
          status: "ACTIVE",
          referralCode: founderId,
          membershipId: platinum.id,
          ...(bankAccount ? { bankAccount } : {})
        },
        select: { id: true }
      });

      await tx.wallet.create({
        data: {
          userId: user.id,
          balance: new Prisma.Decimal(0),
          cashBalance: new Prisma.Decimal(0),
          ppobBalance: new Prisma.Decimal(0),
          currency: "IDR"
        }
      });

      const userMembership = await tx.userMembership.create({
        data: {
          userId: user.id,
          membershipId: platinum.id,
          status: "ACTIVE",
          founderRole: "FOUNDER_CHAIRMAN",
          activeAt: now,
          metadata: {
            source: "FOUNDER_CHAIRMAN",
            founderRole: "FOUNDER_CHAIRMAN",
            founderId,
            grantedBy: input.actorId,
            grantedAt: now.toISOString(),
            reason,
            noInvoice: true,
            noPayment: true,
            noRevenueRecognition: true,
            noAutomaticPpobBenefit: true
          }
        }
      });

      const grant = await tx.founderProgramGrant.create({
        data: {
          userId: user.id,
          membershipId: platinum.id,
          userMembershipId: userMembership.id,
          founderRole: "FOUNDER_CHAIRMAN",
          grantedBy: input.actorId,
          reason,
          metadata: {
            founderId,
            secureBankAccountReference: input.secureBankAccountReference ?? null,
            bankAccountMasked,
            noInvoice: true,
            noPayment: true,
            noRevenueRecognition: true,
            noAutomaticPpobBenefit: true
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "FOUNDER_CHAIRMAN_GRANTED",
          entityType: "FOUNDER_PROGRAM_GRANT",
          entityId: grant.id,
          metadata: {
            targetUserId: user.id,
            founderRole: "FOUNDER_CHAIRMAN",
            founderId,
            membershipId: platinum.id,
            reason,
            secureBankAccountReference: input.secureBankAccountReference ?? null,
            bankAccountMasked
          }
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });

    return this.founderChairmanDetail(founderId);
  }

  async founderPlatinumList() {
    const grants = await this.prisma.founderProgramGrant.findMany({
      where: { founderRole: "FOUNDER_PLATINUM" },
      include: {
        user: {
          include: {
            wallet: true,
            membership: true,
            sponsoredReferrals: { select: { id: true } },
            commissions: {
              where: { status: "POSTED" },
              select: { amount: true, type: true }
            }
          }
        },
        membership: true,
        actor: { select: { id: true, fullName: true, phone: true, role: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    const items = grants.map((grant) => this.founderSummary(grant));
    const active = items.filter((item) => item.status === "ACTIVE").length;
    const suspended = items.filter((item) => item.status === "SUSPENDED").length;
    const revoked = items.filter((item) => item.status === "REVOKED").length;

    return {
      totalSlot: 10,
      usedSlot: active + suspended,
      availableSlot: Math.max(0, 10 - active - suspended),
      statusSummary: {
        ACTIVE: active,
        SUSPENDED: suspended,
        REVOKED: revoked
      },
      items
    };
  }

  async founderPlatinumDetail(founderId: string) {
    const grant = await this.prisma.founderProgramGrant.findFirst({
      where: {
        founderRole: "FOUNDER_PLATINUM",
        user: { referralCode: founderId.trim().toUpperCase() }
      },
      include: {
        user: {
          include: {
            wallet: true,
            membership: true,
            sponsoredReferrals: { select: { id: true } },
            commissions: {
              where: { status: "POSTED" },
              orderBy: { createdAt: "desc" },
              select: { amount: true, type: true, level: true, createdAt: true, triggerId: true }
            }
          }
        },
        membership: true,
        actor: { select: { id: true, fullName: true, phone: true, role: true } },
        userMembership: { include: { membership: true } }
      }
    });

    if (!grant) {
      throw new AppError("Founder Platinum account not found", StatusCodes.NOT_FOUND, "FOUNDER_PLATINUM_NOT_FOUND");
    }

    const auditTrail = await this.prisma.auditLog.findMany({
      where: {
        entityType: "FOUNDER_PROGRAM_GRANT",
        entityId: grant.id
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { id: true, fullName: true, role: true } } }
    });

    return {
      ...this.founderSummary(grant),
      auditTrail: auditTrail.map((log) => ({
        id: log.id,
        action: log.action,
        actor: log.actor,
        metadata: log.metadata,
        createdAt: log.createdAt
      }))
    };
  }

  async updateFounderPlatinumStatus(input: FounderPlatinumStatusInput) {
    const founderId = input.founderId.trim().toUpperCase();
    const targetStatus = input.status;
    const reason = input.reason?.trim();

    if ((targetStatus === "SUSPENDED" || targetStatus === "REVOKED") && !reason) {
      throw new AppError("Reason is required for suspend or revoke", StatusCodes.BAD_REQUEST, "FOUNDER_STATUS_REASON_REQUIRED");
    }

    await this.prisma.$transaction(async (tx) => {
      const grant = await tx.founderProgramGrant.findFirst({
        where: {
          founderRole: "FOUNDER_PLATINUM",
          user: { referralCode: founderId }
        },
        include: { user: true }
      });

      if (!grant) {
        throw new AppError("Founder Platinum account not found", StatusCodes.NOT_FOUND, "FOUNDER_PLATINUM_NOT_FOUND");
      }

      const currentStatus = this.founderStatusFromGrant(grant);
      this.assertFounderStatusTransition(currentStatus, targetStatus);

      const now = new Date();
      const history = [
        ...this.founderStatusHistory(grant.metadata),
        {
          from: currentStatus,
          to: targetStatus,
          actorId: input.actorId,
          reason: reason ?? null,
          at: now.toISOString()
        }
      ];

      if (targetStatus === "SUSPENDED") {
        await tx.user.update({
          where: { id: grant.userId },
          data: { status: "SUSPENDED" }
        });
        await tx.founderProgramGrant.update({
          where: { id: grant.id },
          data: {
            metadata: {
              ...this.asObject(grant.metadata),
              founderStatus: "SUSPENDED",
              suspendedAt: now.toISOString(),
              suspendedBy: input.actorId,
              suspendReason: reason,
              statusHistory: history
            }
          }
        });
      } else if (targetStatus === "ACTIVE") {
        await tx.user.update({
          where: { id: grant.userId },
          data: { status: "ACTIVE" }
        });
        await tx.founderProgramGrant.update({
          where: { id: grant.id },
          data: {
            metadata: {
              ...this.asObject(grant.metadata),
              founderStatus: "ACTIVE",
              reactivatedAt: now.toISOString(),
              reactivatedBy: input.actorId,
              reactivateReason: reason ?? null,
              statusHistory: history
            }
          }
        });
      } else {
        await tx.user.update({
          where: { id: grant.userId },
          data: { status: "SUSPENDED" }
        });
        await tx.founderProgramGrant.update({
          where: { id: grant.id },
          data: {
            revokedAt: now,
            revokedBy: input.actorId,
            metadata: {
              ...this.asObject(grant.metadata),
              founderStatus: "REVOKED",
              revokedAt: now.toISOString(),
              revokedBy: input.actorId,
              revokeReason: reason,
              statusHistory: history
            }
          }
        });
      }

      const action = `FOUNDER_PLATINUM_${targetStatus}`;
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action,
          entityType: "FOUNDER_PROGRAM_GRANT",
          entityId: grant.id,
          metadata: {
            founderId,
            targetUserId: grant.userId,
            from: currentStatus,
            to: targetStatus,
            reason: reason ?? null
          }
        }
      });

    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });

    return this.founderPlatinumDetail(founderId);
  }

  async founderChairman() {
    const grants = await this.prisma.founderProgramGrant.findMany({
      where: { founderRole: "FOUNDER_CHAIRMAN" },
      include: {
        user: {
          include: {
            wallet: true,
            membership: true,
            sponsoredReferrals: { select: { id: true } },
            commissions: {
              where: { status: "POSTED" },
              select: { amount: true, type: true }
            }
          }
        },
        membership: true,
        actor: { select: { id: true, fullName: true, phone: true, role: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    const items = grants.map((grant) => this.founderSummary(grant));
    const active = items.filter((item) => item.status === "ACTIVE").length;
    const suspended = items.filter((item) => item.status === "SUSPENDED").length;
    const revoked = items.filter((item) => item.status === "REVOKED").length;

    return {
      totalSlot: 1,
      usedSlot: items.length > 0 ? 1 : 0,
      availableSlot: items.length > 0 ? 0 : 1,
      statusSummary: {
        ACTIVE: active,
        SUSPENDED: suspended,
        REVOKED: revoked
      },
      item: items[0] ?? null,
      items
    };
  }

  async founderChairmanDetail(founderId: string) {
    const grant = await this.prisma.founderProgramGrant.findFirst({
      where: {
        founderRole: "FOUNDER_CHAIRMAN",
        user: { referralCode: founderId.trim().toUpperCase() }
      },
      include: {
        user: {
          include: {
            wallet: true,
            membership: true,
            sponsoredReferrals: { select: { id: true } },
            commissions: {
              where: { status: "POSTED" },
              orderBy: { createdAt: "desc" },
              select: { amount: true, type: true, level: true, createdAt: true, triggerId: true }
            }
          }
        },
        membership: true,
        actor: { select: { id: true, fullName: true, phone: true, role: true } },
        userMembership: { include: { membership: true } }
      }
    });

    if (!grant) {
      throw new AppError("Founder Chairman account not found", StatusCodes.NOT_FOUND, "FOUNDER_CHAIRMAN_NOT_FOUND");
    }

    const auditTrail = await this.prisma.auditLog.findMany({
      where: {
        entityType: "FOUNDER_PROGRAM_GRANT",
        entityId: grant.id
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { id: true, fullName: true, role: true } } }
    });

    return {
      ...this.founderSummary(grant),
      auditTrail: auditTrail.map((log) => ({
        id: log.id,
        action: log.action,
        actor: log.actor,
        metadata: log.metadata,
        createdAt: log.createdAt
      }))
    };
  }

  async updateFounderChairmanStatus(input: FounderChairmanStatusInput) {
    const founderId = input.founderId.trim().toUpperCase();
    const targetStatus = input.status;
    const reason = input.reason?.trim();

    if ((targetStatus === "SUSPENDED" || targetStatus === "REVOKED") && !reason) {
      throw new AppError("Reason is required for suspend or revoke", StatusCodes.BAD_REQUEST, "FOUNDER_STATUS_REASON_REQUIRED");
    }

    await this.prisma.$transaction(async (tx) => {
      const grant = await tx.founderProgramGrant.findFirst({
        where: {
          founderRole: "FOUNDER_CHAIRMAN",
          user: { referralCode: founderId }
        },
        include: { user: true }
      });

      if (!grant) {
        throw new AppError("Founder Chairman account not found", StatusCodes.NOT_FOUND, "FOUNDER_CHAIRMAN_NOT_FOUND");
      }

      const currentStatus = this.founderStatusFromGrant(grant);
      this.assertFounderStatusTransition(currentStatus, targetStatus);

      const now = new Date();
      const history = [
        ...this.founderStatusHistory(grant.metadata),
        {
          from: currentStatus,
          to: targetStatus,
          actorId: input.actorId,
          reason: reason ?? null,
          at: now.toISOString()
        }
      ];

      if (targetStatus === "SUSPENDED") {
        await tx.user.update({
          where: { id: grant.userId },
          data: { status: "SUSPENDED" }
        });
        await tx.founderProgramGrant.update({
          where: { id: grant.id },
          data: {
            metadata: {
              ...this.asObject(grant.metadata),
              founderStatus: "SUSPENDED",
              suspendedAt: now.toISOString(),
              suspendedBy: input.actorId,
              suspendReason: reason,
              statusHistory: history
            }
          }
        });
      } else if (targetStatus === "ACTIVE") {
        await tx.user.update({
          where: { id: grant.userId },
          data: { status: "ACTIVE" }
        });
        await tx.founderProgramGrant.update({
          where: { id: grant.id },
          data: {
            metadata: {
              ...this.asObject(grant.metadata),
              founderStatus: "ACTIVE",
              reactivatedAt: now.toISOString(),
              reactivatedBy: input.actorId,
              reactivateReason: reason ?? null,
              statusHistory: history
            }
          }
        });
      } else {
        await tx.user.update({
          where: { id: grant.userId },
          data: { status: "SUSPENDED" }
        });
        await tx.founderProgramGrant.update({
          where: { id: grant.id },
          data: {
            revokedAt: now,
            revokedBy: input.actorId,
            metadata: {
              ...this.asObject(grant.metadata),
              founderStatus: "REVOKED",
              revokedAt: now.toISOString(),
              revokedBy: input.actorId,
              revokeReason: reason,
              statusHistory: history
            }
          }
        });
      }

      const action = `FOUNDER_CHAIRMAN_${targetStatus}`;
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action,
          entityType: "FOUNDER_PROGRAM_GRANT",
          entityId: grant.id,
          metadata: {
            founderId,
            targetUserId: grant.userId,
            from: currentStatus,
            to: targetStatus,
            reason: reason ?? null
          }
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });

    return this.founderChairmanDetail(founderId);
  }

  async dashboardSummary() {
    const [
      totalMembers,
      packageCounts,
      revenue,
      commission,
      sponsorBonus,
      levelBonus,
      rewardBonus,
      profitSharing,
      withdrawPending,
      withdrawApproved,
      walletBalance,
      rewardPending
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: "USER" } }),
      this.prisma.user.groupBy({
        by: ["membershipId"],
        where: { role: "USER" },
        _count: { _all: true }
      }),
      this.prisma.invoice.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true }
      }),
      this.prisma.commission.aggregate({
        where: { status: "POSTED" },
        _sum: { amount: true }
      }),
      this.sumCommissionByTypes(sponsorTypes),
      this.sumCommissionByTypes(levelTypes),
      this.sumCommissionByTypes(rewardTypes),
      this.sumCommissionByTypes(profitSharingTypes),
      this.prisma.withdrawal.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true }
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: ["APPROVED", "PAID"] } },
        _sum: { amount: true }
      }),
      this.prisma.wallet.aggregate({
        _sum: { cashBalance: true }
      }),
      this.prisma.rewardTransaction.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true }
      })
    ]);

    const memberships = await this.prisma.membership.findMany({
      select: { id: true, tier: true }
    });
    const tierByMembershipId = new Map(memberships.map((item) => [item.id, item.tier]));
    const countByTier = new Map<MembershipTier, number>([
      ["BASIC", 0],
      ["SILVER", 0],
      ["GOLD", 0],
      ["PLATINUM", 0]
    ]);

    for (const row of packageCounts) {
      const tier = row.membershipId ? tierByMembershipId.get(row.membershipId) : undefined;
      countByTier.set(tier ?? "BASIC", (countByTier.get(tier ?? "BASIC") ?? 0) + row._count._all);
    }

    return {
      totalMembers,
      totalBasic: countByTier.get("BASIC") ?? 0,
      totalSilver: countByTier.get("SILVER") ?? 0,
      totalGold: countByTier.get("GOLD") ?? 0,
      totalPlatinum: countByTier.get("PLATINUM") ?? 0,
      totalRevenue: this.decimal(revenue._sum.amount),
      totalCommission: this.decimal(commission._sum.amount),
      totalSponsorBonus: this.decimal(sponsorBonus._sum.amount),
      totalLevelBonus: this.decimal(levelBonus._sum.amount),
      totalRewardBonus: this.decimal(rewardBonus._sum.amount),
      totalProfitSharing: this.decimal(profitSharing._sum.amount),
      totalWithdrawPending: this.decimal(withdrawPending._sum.amount),
      totalWithdrawApproved: this.decimal(withdrawApproved._sum.amount),
      totalWalletBalance: this.decimal(walletBalance._sum.cashBalance),
      totalPpobGiven: await this.sumWalletTransactions(["PPOB_BENEFIT"]),
      totalRewardPending: this.decimal(rewardPending._sum.amount)
    };
  }

  async memberRequests(input: PageInput & { status?: MembershipOrderStatus }) {
    const where: Prisma.MembershipOrderWhereInput = {
      ...(input.status ? { status: input.status } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.membershipOrder.count({ where }),
      this.prisma.membershipOrder.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true, referralCode: true } },
          membership: true,
          invoice: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          userMembership: true
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async rejectMemberRequest(input: { orderId: string; adminId: string; reason?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.membershipOrder.findUnique({
        where: { id: input.orderId },
        include: { invoice: true }
      });
      if (!order) {
        throw new AppError("Membership request not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_REQUEST_NOT_FOUND");
      }
      if (order.status !== "PENDING") {
        throw new AppError("Only pending membership requests can be rejected", StatusCodes.CONFLICT, "MEMBERSHIP_REQUEST_INVALID_STATE");
      }

      const metadata = {
        rejectedBy: input.adminId,
        rejectedAt: new Date().toISOString(),
        reason: input.reason ?? null
      };

      const updated = await tx.membershipOrder.update({
        where: { id: input.orderId },
        data: {
          status: "CANCELLED",
          registrationData: {
            ...(this.asObject(order.registrationData)),
            adminRejection: metadata
          }
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true, referralCode: true } },
          membership: true,
          invoice: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          userMembership: true
        }
      });

      if (order.invoice) {
        await tx.invoice.update({
          where: { id: order.invoice.id },
          data: {
            status: "CANCELLED",
            metadata
          }
        });
        await tx.membershipPayment.updateMany({
          where: { orderId: order.id, status: "PENDING" },
          data: {
            status: "CANCELLED",
            metadata
          }
        });
      }

      return updated;
    });
  }

  async bonusReport(input: BonusReportInput) {
    const where: Prisma.CommissionWhereInput = {
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { beneficiaryId: input.userId } : {}),
      ...this.createdAtRange(input)
    };
    const baseWhere = {
      ...(input.type ? { type: input.type } : {}),
      ...(input.userId ? { beneficiaryId: input.userId } : {}),
      ...this.createdAtRange(input)
    };
    const [total, aggregate, pending, posted, items] = await Promise.all([
      this.prisma.commission.count({ where }),
      this.prisma.commission.aggregate({ where, _sum: { amount: true } }),
      this.prisma.commission.aggregate({ where: { ...baseWhere, status: "PENDING" }, _sum: { amount: true } }),
      this.prisma.commission.aggregate({ where: { ...baseWhere, status: "POSTED" }, _sum: { amount: true } }),
      this.prisma.commission.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, fullName: true, phone: true, referralCode: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return {
      totalBonus: this.decimal(aggregate._sum.amount),
      transactionCount: total,
      totalPending: this.decimal(pending._sum.amount),
      totalApprovedPaid: this.decimal(posted._sum.amount),
      ...this.page(items, total, input)
    };
  }

  async ppobReport(input: DateRangeInput) {
    const where: Prisma.WalletTransactionWhereInput = {
      type: "PPOB_BENEFIT",
      ...(input.userId ? { wallet: { userId: input.userId } } : {}),
      ...this.createdAtRange(input)
    };
    const [total, aggregate, items] = await Promise.all([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.aggregate({ where, _sum: { amount: true } }),
      this.prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: {
            include: {
              user: { select: { id: true, fullName: true, phone: true, membership: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return {
      totalPpob: this.decimal(aggregate._sum.amount),
      transactionCount: total,
      totalPending: "0.00",
      totalApprovedPaid: this.decimal(aggregate._sum.amount),
      ...this.page(items, total, input)
    };
  }

  async rewardReport(input: DateRangeInput) {
    return this.bonusReport({ ...input, type: "REWARD_BONUS" });
  }

  async rewards(input: RewardListInput) {
    const where: Prisma.RewardTransactionWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...this.createdAtRange(input)
    };

    const [total, items] = await Promise.all([
      this.prisma.rewardTransaction.count({ where }),
      this.prisma.rewardTransaction.findMany({
        where,
        include: this.rewardInclude(),
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async rewardDetail(rewardId: string) {
    const reward = await this.prisma.rewardTransaction.findUnique({
      where: { id: rewardId },
      include: this.rewardInclude()
    });

    if (!reward) {
      throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
    }

    return reward;
  }

  async approveReward(input: { rewardId: string; adminId: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardTransaction.findUnique({ where: { id: input.rewardId } });
      if (!reward) {
        throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
      }
      if (reward.status !== "PENDING") {
        throw new AppError("Only pending rewards can be approved", StatusCodes.CONFLICT, "REWARD_INVALID_STATE");
      }

      const updated = await tx.rewardTransaction.update({
        where: { id: input.rewardId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          metadata: this.mergeMetadata(reward.metadata, {
            approvedBy: input.adminId,
            approvedNote: input.note ?? null
          })
        },
        include: this.rewardInclude()
      });

      return updated;
    });
  }

  async rejectReward(input: { rewardId: string; adminId: string; reason?: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardTransaction.findUnique({ where: { id: input.rewardId } });
      if (!reward) {
        throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
      }
      if (reward.status !== "PENDING") {
        throw new AppError("Only pending rewards can be rejected", StatusCodes.CONFLICT, "REWARD_INVALID_STATE");
      }

      const updated = await tx.rewardTransaction.update({
        where: { id: input.rewardId },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          metadata: this.mergeMetadata(reward.metadata, {
            rejectedBy: input.adminId,
            rejectReason: input.reason ?? input.note ?? null
          })
        },
        include: this.rewardInclude()
      });

      return updated;
    });
  }

  async markRewardPaid(input: { rewardId: string; adminId: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardTransaction.findUnique({
        where: { id: input.rewardId },
        include: { walletTransaction: true }
      });
      if (!reward) {
        throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
      }
      if (reward.status === "PAID") {
        return tx.rewardTransaction.findUniqueOrThrow({
          where: { id: input.rewardId },
          include: this.rewardInclude()
        });
      }
      if (reward.status !== "APPROVED") {
        throw new AppError("Only approved rewards can be marked paid", StatusCodes.CONFLICT, "REWARD_INVALID_STATE");
      }

      const claim = await tx.rewardTransaction.updateMany({
        where: {
          id: input.rewardId,
          status: "APPROVED",
          walletTransactionId: null
        },
        data: {
          status: "PAID",
          paidAt: new Date(),
          metadata: this.mergeMetadata(reward.metadata, {
            paidBy: input.adminId,
            paidNote: input.note ?? null
          })
        }
      });

      if (claim.count !== 1) {
        return tx.rewardTransaction.findUniqueOrThrow({
          where: { id: input.rewardId },
          include: this.rewardInclude()
        });
      }

      const wallet = await tx.wallet.upsert({
        where: { userId: reward.userId },
        update: {
          balance: { increment: reward.amount },
          cashBalance: { increment: reward.amount }
        },
        create: {
          userId: reward.userId,
          balance: reward.amount,
          cashBalance: reward.amount,
          ppobBalance: new Prisma.Decimal(0),
          currency: "IDR"
        }
      });

      const walletTransaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "REWARD_BONUS",
          amount: reward.amount,
          referenceType: reward.referenceType,
          referenceId: reward.referenceId,
          metadata: {
            rewardTransactionId: reward.id,
            threshold: reward.threshold,
            directSilverCount: reward.directSilverCount
          }
        }
      });

      return tx.rewardTransaction.update({
        where: { id: input.rewardId },
        data: {
          walletId: wallet.id,
          walletTransactionId: walletTransaction.id
        },
        include: this.rewardInclude()
      });
    });
  }

  async financialSummaryReport(input: DateRangeOnlyInput) {
    const [
      walletLiability,
      sponsorBonus,
      levelBonus,
      rewardSummary,
      profitSharingSummary,
      withdrawPending,
      withdrawPaidApproved,
      membershipRevenuePaid,
      packageCounts
    ] = await Promise.all([
      this.walletLiabilityReport(input),
      this.sumCommissionByTypesInRange(sponsorTypes, input),
      this.sumCommissionByTypesInRange(levelTypes, input),
      this.rewardSummaryReport(input),
      this.profitSharingSummaryReport(input),
      this.prisma.withdrawal.aggregate({
        where: { status: "PENDING", ...this.requestedAtRange(input) },
        _sum: { amount: true }
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: ["APPROVED", "PAID"] }, ...this.requestedAtRange(input) },
        _sum: { amount: true }
      }),
      this.prisma.invoice.aggregate({
        where: { status: "PAID", ...this.createdAtRange(input) },
        _sum: { amount: true }
      }),
      this.membershipBreakdown()
    ]);

    return {
      totalCashWalletLiability: walletLiability.totalCashBalance,
      totalPpobLiability: walletLiability.totalPpobBalance,
      totalSponsorBonus: this.decimal(sponsorBonus._sum.amount),
      totalLevelBonus: this.decimal(levelBonus._sum.amount),
      totalRewardPending: rewardSummary.totalPending,
      totalRewardApproved: rewardSummary.totalApproved,
      totalRewardPaid: rewardSummary.totalPaid,
      totalProfitSharing: profitSharingSummary.totalPaid,
      totalWithdrawalPending: this.decimal(withdrawPending._sum.amount),
      totalWithdrawalPaidApproved: this.decimal(withdrawPaidApproved._sum.amount),
      totalMembershipRevenuePaid: this.decimal(membershipRevenuePaid._sum.amount),
      totalActiveBasic: packageCounts.BASIC,
      totalActiveSilver: packageCounts.SILVER,
      totalActiveGold: packageCounts.GOLD,
      totalActivePlatinum: packageCounts.PLATINUM
    };
  }

  async walletLiabilityReport(_input: DateRangeOnlyInput = {}) {
    const [aggregate, cashUsers, ppobUsers] = await Promise.all([
      this.prisma.wallet.aggregate({
        _sum: { cashBalance: true, ppobBalance: true }
      }),
      this.prisma.wallet.count({
        where: { cashBalance: { gt: 0 } }
      }),
      this.prisma.wallet.count({
        where: { ppobBalance: { gt: 0 } }
      })
    ]);

    return {
      totalCashBalance: this.decimal(aggregate._sum.cashBalance),
      totalPpobBalance: this.decimal(aggregate._sum.ppobBalance),
      totalWithdrawableBalance: this.decimal(aggregate._sum.cashBalance),
      totalNonWithdrawablePpob: this.decimal(aggregate._sum.ppobBalance),
      usersWithCashBalance: cashUsers,
      usersWithPpobBalance: ppobUsers
    };
  }

  async commissionSummaryReport(input: DateRangeOnlyInput) {
    const [sponsor, level, reward, profitSharing] = await Promise.all([
      this.sumCommissionByTypesInRange(sponsorTypes, input),
      this.sumCommissionByTypesInRange(levelTypes, input),
      this.sumCommissionByTypesInRange(rewardTypes, input),
      this.sumCommissionByTypesInRange(profitSharingTypes, input)
    ]);

    return {
      sponsorBonusTotal: this.decimal(sponsor._sum.amount),
      levelBonusTotal: this.decimal(level._sum.amount),
      rewardBonusTotal: this.decimal(reward._sum.amount),
      profitSharingTotal: this.decimal(profitSharing._sum.amount),
      period: this.reportPeriod(input)
    };
  }

  async rewardSummaryReport(input: DateRangeOnlyInput) {
    const rows = await this.prisma.rewardTransaction.groupBy({
      by: ["status"],
      where: this.createdAtRange(input),
      _sum: { amount: true },
      _count: { _all: true }
    });

    const summary = {
      countPending: 0,
      countApproved: 0,
      countPaid: 0,
      countRejected: 0,
      totalPending: "0.00",
      totalApproved: "0.00",
      totalPaid: "0.00",
      totalRejected: "0.00"
    };

    for (const row of rows) {
      const amount = this.decimal(row._sum.amount);
      if (row.status === "PENDING") {
        summary.countPending = row._count._all;
        summary.totalPending = amount;
      }
      if (row.status === "APPROVED") {
        summary.countApproved = row._count._all;
        summary.totalApproved = amount;
      }
      if (row.status === "PAID") {
        summary.countPaid = row._count._all;
        summary.totalPaid = amount;
      }
      if (row.status === "REJECTED") {
        summary.countRejected = row._count._all;
        summary.totalRejected = amount;
      }
    }

    return {
      ...summary,
      period: this.reportPeriod(input)
    };
  }

  async profitSharingSummaryReport(input: DateRangeOnlyInput) {
    const [periods, paid] = await Promise.all([
      this.prisma.profitSharingPeriod.aggregate({
        where: this.createdAtRange(input),
        _sum: {
          netProfitAmount: true,
          totalPoolAmount: true,
          silverAllocation: true,
          goldAllocation: true,
          platinumAllocation: true,
          retainedAmount: true
        }
      }),
      this.prisma.profitSharingDistribution.aggregate({
        where: {
          status: "POSTED",
          ...this.createdAtRange(input)
        },
        _sum: { amount: true }
      })
    ]);

    return {
      totalNetProfitInput: this.decimal(periods._sum.netProfitAmount),
      totalPoolAmount: this.decimal(periods._sum.totalPoolAmount),
      totalSilverAllocation: this.decimal(periods._sum.silverAllocation),
      totalGoldAllocation: this.decimal(periods._sum.goldAllocation),
      totalPlatinumAllocation: this.decimal(periods._sum.platinumAllocation),
      totalRetainedUndistributed: this.decimal(periods._sum.retainedAmount),
      totalPaid: this.decimal(paid._sum.amount),
      period: this.reportPeriod(input)
    };
  }

  async ppobSummaryReport(input: DateRangeOnlyInput) {
    const [walletLiability, basic, packageBenefits, packageRows] = await Promise.all([
      this.walletLiabilityReport(input),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: "REGISTRATION_BONUS",
          referenceType: "BASIC_REGISTRATION",
          ...this.createdAtRange(input)
        },
        _sum: { amount: true }
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: "PPOB_BENEFIT",
          ...this.createdAtRange(input)
        },
        _sum: { amount: true }
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          type: "PPOB_BENEFIT",
          ...this.createdAtRange(input)
        },
        select: { amount: true, metadata: true }
      })
    ]);

    const byPackage = new Map<string, Prisma.Decimal>([
      ["SILVER", new Prisma.Decimal(0)],
      ["GOLD", new Prisma.Decimal(0)],
      ["PLATINUM", new Prisma.Decimal(0)],
      ["UNKNOWN", new Prisma.Decimal(0)]
    ]);

    for (const row of packageRows) {
      const metadata = this.asObject(row.metadata);
      const packageName = String(metadata.packageName ?? "UNKNOWN").toUpperCase();
      const key = packageName.includes("SILVER")
        ? "SILVER"
        : packageName.includes("GOLD")
          ? "GOLD"
          : packageName.includes("PLATINUM")
            ? "PLATINUM"
            : "UNKNOWN";
      byPackage.set(key, (byPackage.get(key) ?? new Prisma.Decimal(0)).plus(row.amount));
    }

    return {
      basicRegistrationPpobTotal: this.decimal(basic._sum.amount),
      silverPpobTotal: this.decimal(byPackage.get("SILVER")),
      goldPpobTotal: this.decimal(byPackage.get("GOLD")),
      platinumPpobTotal: this.decimal(byPackage.get("PLATINUM")),
      unknownPackagePpobTotal: this.decimal(byPackage.get("UNKNOWN")),
      packagePpobBenefitTotal: this.decimal(packageBenefits._sum.amount),
      totalPpobLiability: walletLiability.totalPpobBalance,
      totalNonWithdrawablePpob: walletLiability.totalNonWithdrawablePpob,
      period: this.reportPeriod(input)
    };
  }

  async deleteRequests(input: PageInput & { status?: string }) {
    const where: Prisma.AccountDeletionRequestWhereInput = {
      ...(input.status ? { status: input.status as never } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.accountDeletionRequest.count({ where }),
      this.prisma.accountDeletionRequest.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, phone: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return this.page(items, total, input);
  }

  async contactMessages(input: PageInput & { status?: string }) {
    const where: Prisma.ContactMessageWhereInput = {
      ...(input.status ? { status: input.status as never } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return this.page(items, total, input);
  }

  async members(input: MemberListInput) {
    const where = this.memberWhere(input);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: {
          membership: true,
          wallet: true,
          referralRecord: {
            include: {
              sponsor: { select: { id: true, fullName: true, phone: true, referralCode: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    const items = await Promise.all(users.map((user) => this.memberSummary(user)));
    return this.page(items, total, input);
  }

  async memberDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        wallet: true,
        referralRecord: {
          include: {
            sponsor: { select: { id: true, fullName: true, phone: true, referralCode: true } }
          }
        },
        userMemberships: {
          where: { status: "ACTIVE" },
          include: {
            membership: { include: { benefits: true } },
            order: { include: { invoice: true } }
          },
          orderBy: { activeAt: "desc" },
          take: 1
        },
        invoices: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            order: { include: { membership: true } },
            payments: { orderBy: { createdAt: "desc" }, take: 3 }
          }
        },
        commissions: {
          orderBy: { createdAt: "desc" },
          take: 20
        }
      }
    });

    if (!user) {
      throw new AppError("Member not found", StatusCodes.NOT_FOUND, "ADMIN_MEMBER_NOT_FOUND");
    }

    return {
      ...(await this.memberSummary(user)),
      profile: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        referralCode: user.referralCode,
        status: user.status,
        joinedAt: user.createdAt
      },
      activeMembership: user.userMemberships[0] ?? null,
      invoices: user.invoices,
      commissions: user.commissions
    };
  }

  async payments(input: PaymentListInput) {
    const where = input.status ? { status: input.status } : {};
    const [total, items] = await Promise.all([
      this.prisma.membershipPayment.count({ where }),
      this.prisma.membershipPayment.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          invoice: true,
          order: { include: { membership: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async invoices(input: PaymentListInput) {
    const where = input.status ? { status: input.status } : {};
    const [total, items] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          order: { include: { membership: true } },
          payments: { orderBy: { createdAt: "desc" }, take: 1 }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async commissions(input: CommissionListInput) {
    const where: Prisma.CommissionWhereInput = {
      ...(input.type ? { type: input.type } : {}),
      ...(input.bonusType ? { type: { in: this.typesForBonus(input.bonusType) } } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.commission.count({ where }),
      this.prisma.commission.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, fullName: true, phone: true, referralCode: true } },
          referral: {
            include: {
              user: { select: { id: true, fullName: true, phone: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async wallets(input: PageInput) {
    const [total, items] = await Promise.all([
      this.prisma.wallet.count(),
      this.prisma.wallet.findMany({
        include: {
          user: { select: { id: true, fullName: true, phone: true, referralCode: true, membership: true } },
          _count: { select: { ledger: true, withdrawals: true } }
        },
        orderBy: { cashBalance: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async walletTransactions(userId: string, input: PageInput) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true } } }
    });

    if (!wallet) {
      return this.page([], 0, input);
    }

    const [total, items] = await Promise.all([
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return {
      wallet,
      ...this.page(items, total, input)
    };
  }

  private async memberSummary(user: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string;
    referralCode: string;
    createdAt: Date;
    membership: { tier: MembershipTier; name: string } | null;
    wallet: { balance: Prisma.Decimal; cashBalance: Prisma.Decimal; ppobBalance: Prisma.Decimal } | null;
    referralRecord: {
      sponsor: { id: string; fullName: string; phone: string; referralCode: string };
    } | null;
  }) {
    const [directSponsorCount, totalDownline, commissionTotal, activeMembership] = await Promise.all([
      this.prisma.referral.count({ where: { sponsorId: user.id, status: "ACTIVE" } }),
      this.prisma.referralLevel.count({ where: { ancestorId: user.id } }),
      this.prisma.commission.aggregate({
        where: { beneficiaryId: user.id, status: "POSTED" },
        _sum: { amount: true }
      }),
      this.prisma.userMembership.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        include: {
          membership: true,
          order: { include: { invoice: true } }
        },
        orderBy: { activeAt: "desc" }
      })
    ]);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      referralCode: user.referralCode,
      joinedAt: user.createdAt,
      membership: user.membership,
      activeMembership,
      sponsor: user.referralRecord?.sponsor ?? null,
      directSponsorCount,
      totalDownline,
      walletBalance: this.decimal(user.wallet?.cashBalance),
      ppobBalance: this.decimal(activeMembership?.membership.ppobBalance),
      commissionTotal: this.decimal(commissionTotal._sum.amount)
    };
  }

  private memberWhere(input: MemberListInput): Prisma.UserWhereInput {
    return {
      role: "USER",
      ...(input.package ? { membership: { tier: input.package } } : {}),
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.search
        ? {
            OR: [
              { fullName: { contains: input.search, mode: "insensitive" } },
              { phone: { contains: input.search, mode: "insensitive" } },
              { referralCode: { contains: input.search, mode: "insensitive" } }
            ]
          }
        : {})
    };
  }

  private sumCommissionByTypes(types: CommissionType[]) {
    return this.prisma.commission.aggregate({
      where: { status: "POSTED", type: { in: types } },
      _sum: { amount: true }
    });
  }

  private sumCommissionByTypesInRange(types: CommissionType[], input: DateRangeOnlyInput) {
    return this.prisma.commission.aggregate({
      where: {
        status: "POSTED",
        type: { in: types },
        ...this.createdAtRange(input)
      },
      _sum: { amount: true }
    });
  }

  private async sumWalletTransactions(types: WalletTransactionType[]) {
    const result = await this.prisma.walletTransaction.aggregate({
      where: { type: { in: types } },
      _sum: { amount: true }
    });
    return this.decimal(result._sum.amount);
  }

  private createdAtRange(input: { dateFrom?: Date; dateTo?: Date }) {
    if (!input.dateFrom && !input.dateTo) {
      return {};
    }
    return {
      createdAt: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {})
      }
    };
  }

  private requestedAtRange(input: { dateFrom?: Date; dateTo?: Date }) {
    if (!input.dateFrom && !input.dateTo) {
      return {};
    }
    return {
      requestedAt: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {})
      }
    };
  }

  private async membershipBreakdown() {
    const [memberships, packageCounts] = await Promise.all([
      this.prisma.membership.findMany({ select: { id: true, tier: true } }),
      this.prisma.user.groupBy({
        by: ["membershipId"],
        where: { role: "USER", status: "ACTIVE" },
        _count: { _all: true }
      })
    ]);

    const tierByMembershipId = new Map(memberships.map((item) => [item.id, item.tier]));
    const countByTier: Record<MembershipTier, number> = {
      BASIC: 0,
      SILVER: 0,
      GOLD: 0,
      PLATINUM: 0
    };

    for (const row of packageCounts) {
      const tier = row.membershipId ? tierByMembershipId.get(row.membershipId) : "BASIC";
      countByTier[tier ?? "BASIC"] += row._count._all;
    }

    return countByTier;
  }

  private asObject(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private mergeMetadata(value: Prisma.JsonValue | null | undefined, patch: Prisma.InputJsonObject): Prisma.InputJsonObject {
    return {
      ...(this.asObject(value) as Prisma.InputJsonObject),
      ...patch
    };
  }

  private rewardInclude() {
    return {
      user: { select: { id: true, fullName: true, phone: true, referralCode: true, membership: true } },
      wallet: true,
      walletTransaction: true
    } satisfies Prisma.RewardTransactionInclude;
  }

  private reportPeriod(input: DateRangeOnlyInput) {
    return {
      dateFrom: input.dateFrom?.toISOString() ?? null,
      dateTo: input.dateTo?.toISOString() ?? null
    };
  }

  private typesForBonus(type: "sponsor" | "level" | "reward" | "profit_sharing") {
    return {
      sponsor: sponsorTypes,
      level: levelTypes,
      reward: rewardTypes,
      profit_sharing: profitSharingTypes
    }[type];
  }

  private decimal(value: Prisma.Decimal | null | undefined) {
    return value?.toFixed(2) ?? "0.00";
  }

  private founderStatusFromGrant(grant: {
    revokedAt: Date | null;
    user: { status: string };
  }): FounderProgramStatus {
    if (grant.revokedAt) {
      return "REVOKED";
    }
    if (grant.user.status === "SUSPENDED") {
      return "SUSPENDED";
    }
    return "ACTIVE";
  }

  private founderStatusHistory(value: Prisma.JsonValue | null | undefined) {
    const metadata = this.asObject(value);
    const history = metadata.statusHistory;
    return Array.isArray(history) ? history : [];
  }

  private assertFounderStatusTransition(current: FounderProgramStatus, target: FounderProgramStatus) {
    if (current === target) {
      throw new AppError("Founder already has this status", StatusCodes.CONFLICT, "FOUNDER_STATUS_UNCHANGED");
    }

    const allowed: Record<FounderProgramStatus, FounderProgramStatus[]> = {
      ACTIVE: ["SUSPENDED", "REVOKED"],
      SUSPENDED: ["ACTIVE", "REVOKED"],
      REVOKED: []
    };

    if (!allowed[current].includes(target)) {
      throw new AppError("Founder status transition is not allowed", StatusCodes.CONFLICT, "FOUNDER_STATUS_TRANSITION_INVALID");
    }
  }

  private maskBankAccount(value: Prisma.JsonValue | null | undefined) {
    const account = this.asObject(value);
    const accountNumber = account.accountNumber?.toString();
    if (!accountNumber) {
      return null;
    }

    const visible = accountNumber.slice(-4);
    return `${"*".repeat(Math.max(6, accountNumber.length - visible.length))}${visible}`;
  }

  private founderSummary(grant: {
    id: string;
    userId: string;
    founderRole: string;
    grantedBy: string | null;
    revokedAt: Date | null;
    revokedBy: string | null;
    createdAt: Date;
    metadata: Prisma.JsonValue | null;
    user: {
      id: string;
      fullName: string;
      phone: string;
      email: string | null;
      referralCode: string;
      status: string;
      bankAccount: Prisma.JsonValue | null;
      wallet: { balance: Prisma.Decimal; cashBalance: Prisma.Decimal; ppobBalance: Prisma.Decimal } | null;
      membership: { tier: MembershipTier; name: string } | null;
      sponsoredReferrals: Array<{ id: string }>;
      commissions: Array<{ amount: Prisma.Decimal; type: CommissionType }>;
    };
    membership: { tier: MembershipTier; name: string };
    actor: { id: string; fullName: string; phone: string; role: string } | null;
  }) {
    const sponsorBonus = grant.user.commissions
      .filter((item) => sponsorTypes.includes(item.type))
      .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    const levelBonus = grant.user.commissions
      .filter((item) => levelTypes.includes(item.type))
      .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    const totalCommission = grant.user.commissions
      .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));

    return {
      id: grant.id,
      founderId: grant.user.referralCode,
      userId: grant.userId,
      name: grant.user.fullName,
      phone: grant.user.phone,
      email: grant.user.email,
      membership: grant.founderRole === "FOUNDER_CHAIRMAN" ? "Founder Chairman / Platinum" : "Founder Platinum",
      membershipTier: grant.membership.tier,
      founderRole: grant.founderRole,
      status: this.founderStatusFromGrant(grant),
      accountStatus: grant.user.status,
      grantedDate: grant.createdAt,
      grantedAt: grant.createdAt,
      grantedBy: grant.actor,
      revokedAt: grant.revokedAt,
      revokedBy: grant.revokedBy,
      referralCount: grant.user.sponsoredReferrals.length,
      walletCash: this.decimal(grant.user.wallet?.cashBalance),
      walletPpob: this.decimal(grant.user.wallet?.ppobBalance),
      bankAccountMasked: this.maskBankAccount(grant.user.bankAccount),
      totalSponsorBonus: this.decimal(sponsorBonus),
      totalLevelBonus: this.decimal(levelBonus),
      totalCommission: this.decimal(totalCommission),
      metadata: grant.metadata
    };
  }

  private async generateFounderReferralCode(tx: Prisma.TransactionClient) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = `FND${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
      const existing = await tx.user.findUnique({ where: { referralCode: code }, select: { id: true } });
      if (!existing) {
        return code;
      }
    }

    throw new AppError("Failed to generate founder referral code", StatusCodes.INTERNAL_SERVER_ERROR, "FOUNDER_REFERRAL_CODE_GENERATION_FAILED");
  }

  private skip(input: PageInput) {
    return (input.page - 1) * input.pageSize;
  }

  private page<T>(items: T[], total: number, input: PageInput) {
    return {
      items,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize)
      }
    };
  }
}
