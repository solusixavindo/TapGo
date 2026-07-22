import { MembershipTier, Prisma, User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  decimalString,
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

const membershipService = new MembershipOrderService(prisma);
let sequence = 0;

describe.skipIf(!runIntegration)("Final reward engine thresholds", () => {
  setupReferralWalletIntegration();

  it("does not create reward with 9 direct active Silver", async () => {
    const sponsor = await registerAndActivate("REWARD9", "SILVER");
    await addDirectActiveSilverReferrals(sponsor.id, 9, "R9");
    await addDirectBasicReferral(sponsor.id, "R9BASIC");
    await triggerNonSilverOrder(sponsor, "GOLD");
    const rewards = await prisma.rewardTransaction.findMany({ where: { userId: sponsor.id } });
    expect(rewards).toHaveLength(0);
  });

  it("creates pending reward once for 10, 100, and 1000 direct active Silver thresholds", async () => {
    for (const [threshold, expectedAmount] of [
      [10, "500000.00"],
      [100, "5000000.00"],
      [1000, "50000000.00"]
    ] as Array<[number, string]>) {
      const sponsor = await registerAndActivate(`REWARD${threshold}`, "SILVER");
      await addDirectActiveSilverReferrals(sponsor.id, threshold - 1, `R${threshold}`);
      await triggerDirectSilver(sponsor);

      const reward = await prisma.rewardTransaction.findUniqueOrThrow({
        where: {
          userId_referenceType_referenceId: {
            userId: sponsor.id,
            referenceType: "REWARD_MILESTONE",
            referenceId: `DIRECT_SILVER_${threshold}`
          }
        }
      });
      const duplicateCount = await prisma.rewardTransaction.count({
        where: { userId: sponsor.id, referenceId: `DIRECT_SILVER_${threshold}` }
      });
      const walletReward = await prisma.walletTransaction.count({
        where: { wallet: { userId: sponsor.id }, type: "REWARD_BONUS", referenceId: `DIRECT_SILVER_${threshold}` }
      });

      expect(decimalString(reward.amount)).toBe(expectedAmount);
      expect(reward.status).toBe("PENDING");
      expect(reward.directSilverCount).toBeGreaterThanOrEqual(threshold);
      expect(duplicateCount).toBe(1);
      expect(walletReward).toBe(0);
    }
  }, 30000);

  it("ignores Basic/Pending direct referrals and disables old Platinum plus 10 Basic rule", async () => {
    const silverSponsor = await registerAndActivate("REWARDMIX", "SILVER");
    await addDirectActiveSilverReferrals(silverSponsor.id, 9, "RMIXACTIVE");
    await addDirectBasicReferral(silverSponsor.id, "RMIXBASIC");
    await triggerNonSilverOrder(silverSponsor, "GOLD");
    expect(await prisma.rewardTransaction.count({ where: { userId: silverSponsor.id } })).toBe(0);

    const platinumSponsor = await registerAndActivate("REWARDPLAT", "PLATINUM");
    for (let index = 0; index < 10; index += 1) {
      await addDirectBasicReferral(platinumSponsor.id, `RPLATBASIC${index}`);
    }
    await triggerNonSilverOrder(platinumSponsor, "GOLD");
    expect(await prisma.rewardTransaction.count({ where: { userId: platinumSponsor.id } })).toBe(0);
  });
});

async function registerAndActivate(label: string, tier: MembershipTier) {
  const user = await registerUser(label);
  await activateUserPackage(user.id, tier);
  return user;
}

async function triggerDirectSilver(sponsor: User) {
  const direct = await registerUser(`TRIG${sequence}`, sponsor.referralCode);
  await payPackage(direct, "SILVER");
}

async function triggerNonSilverOrder(sponsor: User, tier: "GOLD" | "PLATINUM") {
  const direct = await registerUser(`NONSILVER${sequence}`, sponsor.referralCode);
  await payPackage(direct, tier);
}

async function addDirectBasicReferral(sponsorId: string, label: string) {
  const user = await registerUser(label);
  await prisma.referral.create({ data: { sponsorId, userId: user.id } });
  await prisma.referralLevel.create({ data: { ancestorId: sponsorId, descendantId: user.id, level: 1 } });
}

async function addDirectActiveSilverReferrals(sponsorId: string, count: number, prefix: string) {
  if (count <= 0) {
    return;
  }

  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const users = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    fullName: `${prefix} Silver ${index}`,
    phone: `+62877${String(sequence).padStart(4, "0")}${String(index).padStart(6, "0")}`,
    referralCode: `${prefix}${String(index).padStart(6, "0")}`.replace(/[^A-Z0-9]/gi, "").slice(0, 24).toUpperCase(),
    membershipId: silver.id
  }));
  sequence += 1;

  await prisma.user.createMany({ data: users });
  await prisma.wallet.createMany({
    data: users.map((user) => ({
      userId: user.id,
      balance: new Prisma.Decimal(0),
      cashBalance: new Prisma.Decimal(0),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }))
  });
  await prisma.userMembership.createMany({
    data: users.map((user) => ({
      userId: user.id,
      membershipId: silver.id,
      status: "ACTIVE",
      activeAt: new Date()
    }))
  });
  await prisma.referral.createMany({
    data: users.map((user) => ({ sponsorId, userId: user.id })),
    skipDuplicates: true
  });
  await prisma.referralLevel.createMany({
    data: users.map((user) => ({ ancestorId: sponsorId, descendantId: user.id, level: 1 })),
    skipDuplicates: true
  });
}

async function registerUser(label: string, sponsorReferralCode?: string) {
  sequence += 1;
  return registerBasicUser(`${label}${sequence}`.replace(/[^A-Z0-9]/gi, "").slice(0, 20).toUpperCase(), sponsorReferralCode);
}

async function payPackage(user: User, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const order = await membershipService.createOrder({ userId: user.id, packageId: membership.id });
  await membershipService.markPaymentSuccess({
    userId: user.id,
    role: "USER",
    orderId: order.id,
    paymentReference: `reward-${tier}-${sequence}`
  });
  return order;
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  await prisma.userMembership.create({
    data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}
