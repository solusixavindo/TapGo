import { MembershipTier, Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  MembershipPlan,
  MembershipRepository,
  UserMembershipStatus
} from "../domain/MembershipRepository.js";

const membershipInclude = {
  benefits: {
    orderBy: { level: "asc" as const }
  }
};

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(handler, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  async listPlans(): Promise<MembershipPlan[]> {
    const plans = await this.prisma.membership.findMany({
      include: membershipInclude,
      orderBy: { price: "asc" }
    });

    return plans.map(this.toPlan);
  }

  async getPlanByTier(tier: MembershipTier, tx: Prisma.TransactionClient = this.prisma): Promise<MembershipPlan | null> {
    const plan = await tx.membership.findUnique({
      where: { tier },
      include: membershipInclude
    });

    return plan ? this.toPlan(plan) : null;
  }

  async getUserMembership(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<UserMembershipStatus> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        membership: {
          include: membershipInclude
        }
      }
    });

    if (!user) {
      throw new AppError("User not found", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
    }

    const membership =
      user.membership ??
      (await tx.membership.findUniqueOrThrow({
        where: { tier: "BASIC" },
        include: membershipInclude
      }));

    return {
      userId: user.id,
      membership: this.toPlan(membership)
    };
  }

  async upgradeUserMembership(
    input: {
      userId: string;
      targetMembershipId: string;
      actorId: string;
      paymentReference: string;
    },
    tx: Prisma.TransactionClient
  ): Promise<UserMembershipStatus> {
    const updatedUser = await tx.user.update({
      where: { id: input.userId },
      data: { membershipId: input.targetMembershipId },
      select: {
        id: true,
        membership: {
          include: membershipInclude
        }
      }
    });

    if (!updatedUser.membership) {
      throw new AppError("Membership update failed", StatusCodes.INTERNAL_SERVER_ERROR, "MEMBERSHIP_UPDATE_FAILED");
    }

    await tx.walletTransaction.create({
      data: {
        wallet: {
          connectOrCreate: {
            where: { userId: input.userId },
            create: {
              userId: input.userId,
              balance: 0,
              cashBalance: 0,
              ppobBalance: 0,
              currency: "IDR"
            }
          }
        },
        type: "ADJUSTMENT",
        amount: new Prisma.Decimal(0),
        referenceType: "MEMBERSHIP_UPGRADE",
        referenceId: input.paymentReference,
        metadata: {
          membershipId: input.targetMembershipId,
          tier: updatedUser.membership.tier
        }
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "MEMBERSHIP_UPGRADED",
        entityType: "user",
        entityId: input.userId,
        metadata: {
          membershipId: input.targetMembershipId,
          tier: updatedUser.membership.tier,
          paymentReference: input.paymentReference
        }
      }
    });

    return {
      userId: updatedUser.id,
      membership: this.toPlan(updatedUser.membership)
    };
  }

  async updatePlan(
    input: {
      tier: MembershipTier;
      name?: string;
      price?: Prisma.Decimal;
      directBonus?: Prisma.Decimal;
      activeLevels?: number;
      isActive?: boolean;
      benefits?: Array<{
        level: number;
        commissionRate: Prisma.Decimal;
        fixedBonus: Prisma.Decimal;
        isActive?: boolean;
      }>;
      adminId: string;
    },
    tx: Prisma.TransactionClient
  ): Promise<MembershipPlan> {
    const membership = await tx.membership.update({
      where: { tier: input.tier },
      data: {
        ...(typeof input.name === "string" ? { name: input.name } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.directBonus !== undefined ? { directBonus: input.directBonus } : {}),
        ...(typeof input.activeLevels === "number" ? { activeLevels: input.activeLevels } : {}),
        ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {})
      }
    });

    if (input.benefits) {
      for (const benefit of input.benefits) {
        await tx.membershipBenefit.upsert({
          where: {
            membershipId_level: {
              membershipId: membership.id,
              level: benefit.level
            }
          },
          update: {
            commissionRate: benefit.commissionRate,
            fixedBonus: benefit.fixedBonus,
            ...(typeof benefit.isActive === "boolean" ? { isActive: benefit.isActive } : {})
          },
          create: {
            membershipId: membership.id,
            level: benefit.level,
            commissionRate: benefit.commissionRate,
            fixedBonus: benefit.fixedBonus,
            isActive: benefit.isActive ?? true
          }
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "MEMBERSHIP_RULES_UPDATED",
        entityType: "membership",
        entityId: membership.id,
        metadata: {
          tier: input.tier,
          benefitLevels: input.benefits?.map((benefit) => benefit.level) ?? []
        }
      }
    });

    const updated = await tx.membership.findUniqueOrThrow({
      where: { id: membership.id },
      include: membershipInclude
    });

    return this.toPlan(updated);
  }

  private toPlan(plan: {
    id: string;
    tier: MembershipTier;
    name: string;
    price: Prisma.Decimal;
    directBonus: Prisma.Decimal;
    activeLevels: number;
    isActive: boolean;
    benefits: Array<{
      id: string;
      level: number;
      commissionRate: Prisma.Decimal;
      fixedBonus: Prisma.Decimal;
      isActive: boolean;
    }>;
  }): MembershipPlan {
    return {
      id: plan.id,
      tier: plan.tier,
      name: plan.name,
      price: plan.price,
      directBonus: plan.directBonus,
      activeLevels: plan.activeLevels,
      isActive: plan.isActive,
      benefits: plan.benefits
    };
  }
}
