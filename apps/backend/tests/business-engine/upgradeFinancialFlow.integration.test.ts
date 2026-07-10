import { MembershipTier, Prisma, User } from "@prisma/client";
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

describe.skipIf(!runIntegration)("Upgrade financial flow audit", () => {
  setupReferralWalletIntegration();

  it("uses full package price for paid upgrades until a final differential-price rule is approved", async () => {
    const silver = await registerUser("UPGRADE-SILVER");
    await payPackage(silver, "SILVER");

    const goldPackage = await prisma.membership.findUniqueOrThrow({ where: { tier: "GOLD" } });
    const goldOrder = await membershipService.createOrder({ userId: silver.id, packageId: goldPackage.id });
    expect(decimalString(goldOrder.totalAmount)).toBe("3000000.00");
    await membershipService.markPaymentSuccess({ userId: silver.id, role: "USER", orderId: goldOrder.id });

    const platinumPackage = await prisma.membership.findUniqueOrThrow({ where: { tier: "PLATINUM" } });
    const platinumOrder = await membershipService.createOrder({ userId: silver.id, packageId: platinumPackage.id });
    expect(decimalString(platinumOrder.totalAmount)).toBe("5500000.00");
  });

  it("blocks downgrade and same lower-tier purchases that would create negative financial movement", async () => {
    const platinum = await registerUser("DOWN-PLAT");
    await activateUserPackage(platinum.id, "PLATINUM");
    const gold = await registerUser("DOWN-GOLD");
    await activateUserPackage(gold.id, "GOLD");

    await expect(createPendingOrder(platinum, "SILVER")).rejects.toMatchObject({ code: "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED" });
    await expect(createPendingOrder(platinum, "GOLD")).rejects.toMatchObject({ code: "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED" });
    await expect(createPendingOrder(gold, "SILVER")).rejects.toMatchObject({ code: "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED" });
  });

  it("does not pay sponsor, level, reward, or PPOB benefit while membership order is pending", async () => {
    const sponsor = await registerUser("PENDING-SPONSOR");
    await activateUserPackage(sponsor.id, "SILVER");
    const buyer = await registerUser("PENDING-BUYER", sponsor.referralCode);
    const order = await createPendingOrder(buyer, "SILVER");

    const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
    const sponsorWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const commissions = await prisma.commission.findMany({ where: { triggerId: order.id } });
    const orderLedger = await prisma.walletTransaction.findMany({ where: { referenceId: order.id } });

    expect(order.status).toBe("PENDING");
    expect(decimalString(buyerWallet.ppobBalance)).toBe("5000.00");
    expect(decimalString(sponsorWallet.cashBalance)).toBe("0.00");
    expect(commissions).toHaveLength(0);
    expect(orderLedger).toHaveLength(0);
  });
});

async function registerUser(label: string, sponsorReferralCode?: string) {
  sequence += 1;
  return registerBasicUser(`${label}${sequence}`.replace(/[^A-Z0-9]/gi, "").slice(0, 20).toUpperCase(), sponsorReferralCode);
}

async function createPendingOrder(user: User, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  return membershipService.createOrder({ userId: user.id, packageId: membership.id });
}

async function payPackage(user: User, tier: MembershipTier) {
  const order = await createPendingOrder(user, tier);
  await membershipService.markPaymentSuccess({
    userId: user.id,
    role: "USER",
    orderId: order.id,
    paymentReference: `upgrade-flow-${tier}-${sequence}`
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
