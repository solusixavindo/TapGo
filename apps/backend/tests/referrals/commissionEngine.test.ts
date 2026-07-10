import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CommissionEngine } from "../../src/modules/referrals/application/CommissionEngine.js";

const engine = new CommissionEngine({ allowLegacyUsage: true });

const paidMembership = {
  id: "silver",
  tier: "SILVER" as const,
  directBonus: new Prisma.Decimal(0),
  activeLevels: 10,
  benefits: [
    { level: 1, commissionRate: new Prisma.Decimal(8), fixedBonus: new Prisma.Decimal(0) },
    { level: 2, commissionRate: new Prisma.Decimal(4), fixedBonus: new Prisma.Decimal(0) },
    { level: 3, commissionRate: new Prisma.Decimal(2), fixedBonus: new Prisma.Decimal(0) },
    { level: 4, commissionRate: new Prisma.Decimal(2), fixedBonus: new Prisma.Decimal(0) },
    { level: 5, commissionRate: new Prisma.Decimal(2), fixedBonus: new Prisma.Decimal(0) },
    { level: 6, commissionRate: new Prisma.Decimal(1), fixedBonus: new Prisma.Decimal(0) },
    { level: 10, commissionRate: new Prisma.Decimal(1), fixedBonus: new Prisma.Decimal(0) }
  ]
};

describe("Deprecated CommissionEngine legacy compatibility", () => {
  it("requires explicit legacy opt-in so it cannot become a production payout path silently", () => {
    expect(() => new CommissionEngine()).toThrow("CommissionEngine is deprecated");
  });

  it("is not imported by the current membership payment flow", () => {
    const membershipOrderService = readFileSync(
      resolve(process.cwd(), "src/modules/memberships/application/MembershipOrderService.ts"),
      "utf8"
    );
    const midtransPaymentService = readFileSync(
      resolve(process.cwd(), "src/modules/payments/application/MidtransPaymentService.ts"),
      "utf8"
    );

    expect(membershipOrderService).not.toContain("CommissionEngine");
    expect(midtransPaymentService).not.toContain("CommissionEngine");
  });

  it("calculates sponsor bonus as 8 percent of purchased package price", () => {
    const distributions = engine.calculateSponsorBonus({
      sponsorId: "sponsor",
      sourceUserId: "new-user",
      referralId: "referral",
      triggerType: "PACKAGE_PURCHASED",
      triggerId: "trigger-1",
      packagePrice: new Prisma.Decimal(500000),
      sponsorMembership: paidMembership,
      basicBonusEligible: false
    });

    expect(distributions).toHaveLength(1);
    expect(distributions[0]).toMatchObject({
      beneficiaryId: "sponsor",
      type: "SPONSOR_BONUS",
      level: 1
    });
    expect(distributions[0]?.amount.toString()).toBe("40000");
  });

  it("calculates Basic sponsor bonus as Rp2.000 only for paid membership purchases", () => {
    const distributions = engine.calculateSponsorBonus({
      sponsorId: "basic-sponsor",
      sourceUserId: "new-silver-user",
      referralId: "referral",
      triggerType: "MEMBERSHIP_ORDER",
      triggerId: "order-1",
      packagePrice: new Prisma.Decimal(500000),
      sponsorMembership: {
        id: "basic",
        tier: "BASIC",
        directBonus: new Prisma.Decimal(2000),
        activeLevels: 0,
        benefits: []
      },
      basicBonusEligible: true
    });

    expect(distributions).toHaveLength(1);
    expect(distributions[0]?.type).toBe("BASIC_SPONSOR_BONUS");
    expect(distributions[0]?.amount.toString()).toBe("2000");
  });

  it("does not calculate sponsor bonus for referral registration without a paid package", () => {
    const distributions = engine.calculateSponsorBonus({
      sponsorId: "basic-sponsor",
      sourceUserId: "new-basic-user",
      referralId: "referral",
      triggerType: "BASIC_REFERRAL",
      triggerId: "basic-1",
      packagePrice: new Prisma.Decimal(0),
      sponsorMembership: {
        id: "basic",
        tier: "BASIC",
        directBonus: new Prisma.Decimal(2000),
        activeLevels: 0,
        benefits: []
      },
      basicBonusEligible: true
    });

    expect(distributions).toEqual([]);
  });

  it("calculates level commission from membership tier limits instead of direct sponsor unlocks", () => {
    const distributions = engine.calculateLevelBonuses({
      sourceUserId: "new-user",
      referralId: "referral",
      triggerType: "PACKAGE_PURCHASED",
      triggerId: "package-1",
      packagePrice: new Prisma.Decimal(500000),
      ancestors: [
        { ancestorId: "silver-level-1", level: 1, directSponsorCount: 0, membership: paidMembership },
        { ancestorId: "silver-level-3", level: 3, directSponsorCount: 0, membership: paidMembership },
        { ancestorId: "silver-level-4", level: 4, directSponsorCount: 10, membership: paidMembership },
        { ancestorId: "basic-level-1", level: 1, directSponsorCount: 10, membership: { ...paidMembership, id: "basic", tier: "BASIC", benefits: [] } }
      ]
    });

    expect(distributions.map((item) => item.beneficiaryId)).toEqual(["silver-level-1", "silver-level-3"]);
    expect(distributions.map((item) => item.amount.toString())).toEqual(["40000", "10000"]);
  });

  it("keeps legacy reward payout disabled; final reward uses RewardTransaction lifecycle", () => {
    const distributions = engine.calculateRewardBonus({
      beneficiaryId: "platinum",
      sourceUserId: "new-user",
      referralId: "referral",
      triggerType: "REWARD_QUALIFIED",
      triggerId: "reward:platinum",
      directSponsorCount: 10,
      membership: { ...paidMembership, tier: "PLATINUM" }
    });

    expect(distributions).toEqual([]);
  });

  it("keeps profit sharing as an explicit monthly placeholder", () => {
    expect(engine.calculateProfitSharingPlaceholder()).toEqual([]);
  });
});
