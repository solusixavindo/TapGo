import { MembershipTier, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { MembershipRepository } from "../domain/MembershipRepository.js";

const tierRank: Record<MembershipTier, number> = {
  BASIC: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3
};

export class MembershipService {
  constructor(private readonly membershipRepository: MembershipRepository) {}

  listPlans() {
    return this.membershipRepository.listPlans();
  }

  getMyMembership(userId: string) {
    return this.membershipRepository.getUserMembership(userId);
  }

  async upgrade(input: {
    userId: string;
    targetTier: MembershipTier;
    paymentReference?: string;
  }) {
    return this.membershipRepository.transaction(async (tx) => {
      const current = await this.membershipRepository.getUserMembership(input.userId, tx);
      const target = await this.membershipRepository.getPlanByTier(input.targetTier, tx);

      if (!target || !target.isActive) {
        throw new AppError("Target membership is unavailable", StatusCodes.BAD_REQUEST, "MEMBERSHIP_UNAVAILABLE");
      }

      if (tierRank[target.tier] <= tierRank[current.membership.tier]) {
        throw new AppError("Membership upgrade must move to a higher tier", StatusCodes.BAD_REQUEST, "INVALID_MEMBERSHIP_UPGRADE");
      }

      return this.membershipRepository.upgradeUserMembership(
        {
          userId: input.userId,
          actorId: input.userId,
          targetMembershipId: target.id,
          paymentReference: input.paymentReference ?? `membership:${input.userId}:${target.tier}:${Date.now()}`
        },
        tx
      );
    });
  }

  updateRules(input: {
    adminId: string;
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
  }) {
    if (typeof input.activeLevels === "number" && (input.activeLevels < 0 || input.activeLevels > 10)) {
      throw new AppError("Active levels must be between 0 and 10", StatusCodes.BAD_REQUEST, "INVALID_ACTIVE_LEVELS");
    }

    return this.membershipRepository.transaction((tx) => this.membershipRepository.updatePlan(input, tx));
  }
}
