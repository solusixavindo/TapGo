import { MembershipTier, Prisma, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ProfitSharingService } from "../../src/modules/profit-sharing/application/ProfitSharingService.js";
import {
  decimalString,
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

const profitSharingService = new ProfitSharingService(prisma);
let sequence = 0;

describe.skipIf(!runIntegration)("Final profit sharing formula", () => {
  setupReferralWalletIntegration();

  it("calculates pool allocations from net profit simulations", () => {
    expect(formula(10000000)).toEqual({
      pool: "6000000.00",
      silver: "1800000.00",
      gold: "1200000.00",
      platinum: "600000.00",
      retainedBase: "2400000.00"
    });
    expect(formula(100000000)).toEqual({
      pool: "60000000.00",
      silver: "18000000.00",
      gold: "12000000.00",
      platinum: "6000000.00",
      retainedBase: "24000000.00"
    });
    expect(formula(1000000000)).toEqual({
      pool: "600000000.00",
      silver: "180000000.00",
      gold: "120000000.00",
      platinum: "60000000.00",
      retainedBase: "240000000.00"
    });
  });

  it("distributes only to qualified Silver, Gold, and Platinum and rejects duplicate distribution", async () => {
    const silverUnqualified = await registerAndActivate("PSUNQUAL", "SILVER");
    const silverQualified = await registerAndActivate("PSQUAL", "SILVER");
    await addDirectActiveSilverReferrals(silverQualified.id, 3, "PSQUALDIRECT");
    const gold = await registerAndActivate("PSGOLD", "GOLD");
    const platinum = await registerAndActivate("PSPLAT", "PLATINUM");

    const period = await profitSharingService.createPeriod({
      periodMonth: 7,
      periodYear: 2026,
      netProfitAmount: new Prisma.Decimal(100000000)
    });
    expect(decimalString(period.totalPoolAmount)).toBe("60000000.00");
    expect(decimalString(period.silverAllocation)).toBe("18000000.00");
    expect(decimalString(period.goldAllocation)).toBe("12000000.00");
    expect(decimalString(period.platinumAllocation)).toBe("6000000.00");

    await profitSharingService.approvePeriod(period.id);
    const distributed = await profitSharingService.distribute(period.id);

    await expect(profitSharingService.distribute(period.id)).rejects.toMatchObject({
      code: "PROFIT_SHARING_ALREADY_DISTRIBUTED"
    });

    const distributions = await prisma.profitSharingDistribution.findMany({
      where: { periodId: period.id },
      orderBy: { amount: "desc" }
    });
    const byUser = new Map(distributions.map((distribution) => [distribution.userId, decimalString(distribution.amount)]));
    const retained = await prisma.profitSharingPeriod.findUniqueOrThrow({ where: { id: period.id } });

    expect(distributed.status).toBe("DISTRIBUTED");
    expect(byUser.get(silverQualified.id)).toBe("18000000.00");
    expect(byUser.get(gold.id)).toBe("12000000.00");
    expect(byUser.get(platinum.id)).toBe("6000000.00");
    expect(byUser.has(silverUnqualified.id)).toBe(false);
    expect(distributions).toHaveLength(3);
    expect(decimalString(retained.retainedAmount)).toBe("24000000.00");

    const expectedWallets: Array<[string, string]> = [
      [silverQualified.id, "18000000.00"],
      [gold.id, "12000000.00"],
      [platinum.id, "6000000.00"]
    ];
    for (const [userId, expected] of expectedWallets) {
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
      expect(decimalString(wallet.cashBalance)).toBe(expected);
      expect(decimalString(wallet.balance)).toBe(expected);
    }
  });

  it("retains unpaid category allocation when category has no qualified recipient", async () => {
    await registerAndActivate("PSONLYGOLD", "GOLD");
    const period = await profitSharingService.createPeriod({
      periodMonth: 8,
      periodYear: 2026,
      netProfitAmount: new Prisma.Decimal(100000000)
    });
    await profitSharingService.approvePeriod(period.id);
    await profitSharingService.distribute(period.id);

    const distributions = await prisma.profitSharingDistribution.findMany({ where: { periodId: period.id } });
    const retained = await prisma.profitSharingPeriod.findUniqueOrThrow({ where: { id: period.id } });

    expect(distributions).toHaveLength(1);
    expect(decimalString(distributions[0]!.amount)).toBe("12000000.00");
    expect(decimalString(retained.retainedAmount)).toBe("48000000.00");
  });
});

function formula(netProfit: number) {
  const pool = new Prisma.Decimal(netProfit).mul(60).div(100);
  const silver = pool.mul(30).div(100);
  const gold = pool.mul(20).div(100);
  const platinum = pool.mul(10).div(100);
  return {
    pool: pool.toFixed(2),
    silver: silver.toFixed(2),
    gold: gold.toFixed(2),
    platinum: platinum.toFixed(2),
    retainedBase: pool.minus(silver).minus(gold).minus(platinum).toFixed(2)
  };
}

async function registerAndActivate(label: string, tier: MembershipTier) {
  const user = await registerUser(label);
  await activateUserPackage(user.id, tier);
  return user;
}

async function registerUser(label: string) {
  sequence += 1;
  return registerBasicUser(`${label}${sequence}`.replace(/[^A-Z0-9]/gi, "").slice(0, 20).toUpperCase());
}

async function addDirectActiveSilverReferrals(sponsorId: string, count: number, prefix: string) {
  for (let index = 0; index < count; index += 1) {
    const user = await registerAndActivate(`${prefix}${index}`, "SILVER");
    await prisma.referral.create({ data: { sponsorId, userId: user.id } });
    await prisma.referralLevel.create({ data: { ancestorId: sponsorId, descendantId: user.id, level: 1 } });
  }
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  await prisma.userMembership.create({
    data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}
