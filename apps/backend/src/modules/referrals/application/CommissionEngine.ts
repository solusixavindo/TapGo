import { Prisma } from "@prisma/client";
import { CommissionDistribution, MembershipCommissionProfile } from "../domain/ReferralRepository.js";

type DirectBonusInput = {
  sponsorId: string;
  sourceUserId: string;
  referralId: string;
  triggerType: string;
  triggerId: string;
  packagePrice: Prisma.Decimal;
  sponsorMembership: MembershipCommissionProfile;
  basicBonusEligible: boolean;
};

type LevelBonusInput = {
  ancestors: Array<{
    ancestorId: string;
    level: number;
    directSponsorCount: number;
    membership: MembershipCommissionProfile;
  }>;
  sourceUserId: string;
  referralId: string;
  triggerType: string;
  triggerId: string;
  packagePrice: Prisma.Decimal;
};

type RewardBonusInput = {
  beneficiaryId: string;
  sourceUserId: string;
  referralId: string;
  triggerType: string;
  triggerId: string;
  directSponsorCount: number;
  membership: MembershipCommissionProfile;
};

type LegacyCommissionEngineOptions = {
  allowLegacyUsage?: boolean;
};

/**
 * @deprecated Deprecated legacy engine. Do not use for production payout.
 * Use the current membership payment reward flow in MembershipOrderService
 * and ProfitSharingService instead. This class remains only as a guarded
 * compatibility fixture for old unit tests and historical calculations.
 */
export class CommissionEngine {
  private readonly sponsorBonusRate = new Prisma.Decimal(8);
  private readonly basicSponsorBonusAmount = new Prisma.Decimal(2000);
  private readonly maxLevelByTier = {
    BASIC: 0,
    SILVER: 3,
    GOLD: 5,
    PLATINUM: 10
  } as const;

  constructor(options: LegacyCommissionEngineOptions = {}) {
    if (!options.allowLegacyUsage) {
      throw new Error(
        "CommissionEngine is deprecated. Use MembershipOrderService/ProfitSharingService for production payout."
      );
    }
  }

  calculateSponsorBonus(input: DirectBonusInput): CommissionDistribution[] {
    if (!input.packagePrice.gt(0)) {
      return [];
    }

    const isBasicBonus = input.sponsorMembership.tier === "BASIC";
    const amount = isBasicBonus ? this.basicSponsorBonusAmount : input.packagePrice.mul(this.sponsorBonusRate).div(100);

    if (amount.lte(0)) {
      return [];
    }

    return [
      {
        beneficiaryId: input.sponsorId,
        sourceUserId: input.sourceUserId,
        referralId: input.referralId,
        type: isBasicBonus ? "BASIC_SPONSOR_BONUS" : "SPONSOR_BONUS",
        level: 1,
        amount,
        rate: this.sponsorBonusRate,
        triggerType: input.triggerType,
        triggerId: input.triggerId,
        metadata: {
          membershipTier: input.sponsorMembership.tier,
          rate: isBasicBonus ? "fixed" : this.sponsorBonusRate.toString(),
          rule: isBasicBonus ? "basic.paid_membership.fixed_2000" : "package.price.8_percent"
        }
      }
    ];
  }

  calculateLevelBonuses(input: LevelBonusInput): CommissionDistribution[] {
    return input.ancestors.flatMap((ancestor) => {
      const { membership } = ancestor;
      const unlockedLevel = this.maxLevelByTier[membership.tier];
      if (ancestor.level > unlockedLevel) {
        return [];
      }

      const benefit = membership.benefits.find((item) => item.level === ancestor.level);
      if (!benefit) {
        return [];
      }

      const percentageAmount = input.packagePrice.mul(benefit.commissionRate).div(100);
      const amount = percentageAmount.plus(benefit.fixedBonus);
      if (amount.lte(0)) {
        return [];
      }

      return [
        {
          beneficiaryId: ancestor.ancestorId,
          sourceUserId: input.sourceUserId,
          referralId: input.referralId,
          type: "LEVEL_COMMISSION",
          level: ancestor.level,
          amount,
          rate: benefit.commissionRate,
          triggerType: input.triggerType,
          triggerId: input.triggerId,
          metadata: {
            membershipTier: membership.tier,
            activeLevels: membership.activeLevels,
            directSponsorCount: ancestor.directSponsorCount,
            unlockedLevel,
            fixedBonus: benefit.fixedBonus.toString(),
            commissionRate: benefit.commissionRate.toString(),
            packagePrice: input.packagePrice.toString()
          }
        }
      ];
    });
  }

  /**
   * @deprecated Reward payout is intentionally disabled in this legacy engine.
   * Final reward rules create RewardTransaction records from the paid
   * membership flow, then require admin approval/paid lifecycle.
   */
  calculateRewardBonus(input: RewardBonusInput): CommissionDistribution[] {
    void input;
    return [];
  }

  /**
   * @deprecated Profit sharing is intentionally disabled in this legacy
   * engine. Use ProfitSharingService for approved monthly distribution.
   */
  calculateProfitSharingPlaceholder(): CommissionDistribution[] {
    return [];
  }
}
