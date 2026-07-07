import { Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

export class ProfitSharingService {
  constructor(private readonly prisma: PrismaClient) {}

  createPeriod(input: {
    periodMonth: number;
    periodYear: number;
    netProfitAmount: Prisma.Decimal;
  }) {
    const poolAmount = input.netProfitAmount.mul(60).div(100);
    const silverAllocation = poolAmount.mul(30).div(100);
    const goldAllocation = poolAmount.mul(20).div(100);
    const platinumAllocation = poolAmount.mul(10).div(100);
    const retainedAmount = poolAmount.minus(silverAllocation).minus(goldAllocation).minus(platinumAllocation);

    return this.prisma.profitSharingPeriod.create({
      data: {
        periodMonth: input.periodMonth,
        periodYear: input.periodYear,
        netProfitAmount: input.netProfitAmount,
        totalPoolAmount: poolAmount,
        silverAllocation,
        goldAllocation,
        platinumAllocation,
        retainedAmount,
        status: "DRAFT"
      }
    });
  }

  listPeriods() {
    return this.prisma.profitSharingPeriod.findMany({
      include: { _count: { select: { distributions: true } } },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }]
    });
  }

  async getPeriod(periodId: string) {
    const period = await this.prisma.profitSharingPeriod.findUnique({
      where: { id: periodId },
      include: {
        distributions: {
          include: {
            user: { select: { id: true, fullName: true, phone: true, referralCode: true } }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!period) {
      throw new AppError("Profit sharing period not found", StatusCodes.NOT_FOUND, "PROFIT_SHARING_PERIOD_NOT_FOUND");
    }

    return period;
  }

  async approvePeriod(periodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.profitSharingPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        throw new AppError("Profit sharing period not found", StatusCodes.NOT_FOUND, "PROFIT_SHARING_PERIOD_NOT_FOUND");
      }

      if (period.status !== "DRAFT") {
        throw new AppError("Only draft periods can be approved", StatusCodes.CONFLICT, "PROFIT_SHARING_INVALID_STATE");
      }

      return tx.profitSharingPeriod.update({
        where: { id: periodId },
        data: {
          status: "APPROVED",
          approvedAt: new Date()
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  async distribute(periodId: string) {
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.profitSharingPeriod.findUnique({ where: { id: periodId } });
      if (!period) {
        throw new AppError("Profit sharing period not found", StatusCodes.NOT_FOUND, "PROFIT_SHARING_PERIOD_NOT_FOUND");
      }

      if (period.status === "DISTRIBUTED") {
        throw new AppError("Profit sharing period has already been distributed", StatusCodes.CONFLICT, "PROFIT_SHARING_ALREADY_DISTRIBUTED");
      }

      if (period.status !== "APPROVED") {
        throw new AppError("Only approved periods can be distributed", StatusCodes.CONFLICT, "PROFIT_SHARING_INVALID_STATE");
      }

      const now = new Date();
      const silverMembers = await this.findSilverQualifiedMembers(tx);
      const goldMembers = await this.findActiveMembersByTier(tx, "GOLD");
      const platinumMembers = await this.findActiveMembersByTier(tx, "PLATINUM");
      let allocatedPaid = new Prisma.Decimal(0);

      for (const member of silverMembers) {
        const amount = period.silverAllocation.div(silverMembers.length);
        await this.postDistribution(tx, {
          periodId: period.id,
          userId: member.userId,
          amount,
          category: "SILVER",
          periodMonth: period.periodMonth,
          periodYear: period.periodYear,
          now
        });
        allocatedPaid = allocatedPaid.plus(amount);
      }

      for (const member of goldMembers) {
        const amount = period.goldAllocation.div(goldMembers.length);
        await this.postDistribution(tx, {
          periodId: period.id,
          userId: member.userId,
          amount,
          category: "GOLD",
          periodMonth: period.periodMonth,
          periodYear: period.periodYear,
          now
        });
        allocatedPaid = allocatedPaid.plus(amount);
      }

      for (const member of platinumMembers) {
        const amount = period.platinumAllocation.div(platinumMembers.length);
        await this.postDistribution(tx, {
          periodId: period.id,
          userId: member.userId,
          amount,
          category: "PLATINUM",
          periodMonth: period.periodMonth,
          periodYear: period.periodYear,
          now
        });
        allocatedPaid = allocatedPaid.plus(amount);
      }

      await tx.profitSharingPeriod.update({
        where: { id: period.id },
        data: {
          status: "DISTRIBUTED",
          retainedAmount: period.totalPoolAmount.minus(allocatedPaid),
          distributedAt: now
        }
      });

      return tx.profitSharingPeriod.findUniqueOrThrow({
        where: { id: period.id },
        include: {
          distributions: {
            include: {
              user: { select: { id: true, fullName: true, phone: true, referralCode: true } }
            },
            orderBy: { createdAt: "asc" }
          }
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000
    });
  }

  private async postDistribution(tx: Prisma.TransactionClient, input: {
    periodId: string;
    userId: string;
    amount: Prisma.Decimal;
    category: "SILVER" | "GOLD" | "PLATINUM";
    periodMonth: number;
    periodYear: number;
    now: Date;
  }) {
    const existingDistribution = await tx.profitSharingDistribution.findUnique({
      where: {
        periodId_userId: {
          periodId: input.periodId,
          userId: input.userId
        }
      },
      select: { id: true }
    });

    if (existingDistribution) {
      throw new AppError("Member already received profit sharing for this period", StatusCodes.CONFLICT, "PROFIT_SHARING_DUPLICATE_DISTRIBUTION");
    }

    const wallet = await tx.wallet.upsert({
      where: { userId: input.userId },
      update: {},
      create: {
        userId: input.userId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      },
      select: { id: true }
    });

    const walletTransaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PROFIT_SHARING",
        amount: input.amount,
        referenceType: "PROFIT_SHARING_PERIOD",
        referenceId: input.periodId,
        metadata: {
          category: input.category,
          periodMonth: input.periodMonth,
          periodYear: input.periodYear
        }
      },
      select: { id: true }
    });

    const commission = await tx.commission.create({
      data: {
        beneficiaryId: input.userId,
        sourceUserId: input.userId,
        walletTransactionId: walletTransaction.id,
        type: "PROFIT_SHARING",
        status: "POSTED",
        level: 1,
        amount: input.amount,
        triggerType: "PROFIT_SHARING_PERIOD",
        triggerId: input.periodId,
        metadata: {
          category: input.category,
          periodMonth: input.periodMonth,
          periodYear: input.periodYear
        },
        postedAt: input.now
      },
      select: { id: true }
    });

    await tx.profitSharingDistribution.create({
      data: {
        periodId: input.periodId,
        userId: input.userId,
        amount: input.amount,
        status: "POSTED",
        walletTransactionId: walletTransaction.id,
        commissionId: commission.id,
        postedAt: input.now
      }
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        cashBalance: {
          increment: input.amount
        },
        balance: {
          increment: input.amount
        }
      }
    });
  }

  private async findActiveMembersByTier(tx: Prisma.TransactionClient, tier: "GOLD" | "PLATINUM") {
    return tx.userMembership.findMany({
      where: {
        status: "ACTIVE",
        membership: { tier }
      },
      distinct: ["userId"],
      select: { userId: true },
      orderBy: { userId: "asc" }
    });
  }

  private async findSilverQualifiedMembers(tx: Prisma.TransactionClient) {
    const silverMembers = await tx.userMembership.findMany({
      where: {
        status: "ACTIVE",
        membership: { tier: "SILVER" }
      },
      distinct: ["userId"],
      select: { userId: true },
      orderBy: { userId: "asc" }
    });

    const qualified: Array<{ userId: string }> = [];
    for (const member of silverMembers) {
      const directActiveSilver = await tx.referral.count({
        where: {
          sponsorId: member.userId,
          status: "ACTIVE",
          user: {
            membership: { tier: "SILVER" },
            userMemberships: {
              some: {
                status: "ACTIVE",
                membership: { tier: "SILVER" }
              }
            }
          }
        }
      });

      if (directActiveSilver >= 3) {
        qualified.push(member);
      }
    }

    return qualified;
  }
}
