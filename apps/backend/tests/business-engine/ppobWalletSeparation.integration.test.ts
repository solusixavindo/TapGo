import { MembershipTier, Prisma, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import { walletService } from "../helpers/referralWalletHarness.js";
import {
  decimalString,
  prisma,
  registerBasicUser,
  runIntegration,
  setRegistrationQuotaGranted,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

const membershipService = new MembershipOrderService(prisma);
let sequence = 0;

describe.skipIf(!runIntegration)("P1 PPOB and cash wallet separation", () => {
  setupReferralWalletIntegration();

  it("credits first 1000 Basic registration bonus to PPOB only", async () => {
    const user = await registerUser("PPOB-BASIC");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });

    expect(decimalString(wallet.balance)).toBe("0.00");
    expect(decimalString(wallet.cashBalance)).toBe("0.00");
    expect(decimalString(wallet.ppobBalance)).toBe("5000.00");
    await expect(
      walletService.requestWithdrawal({
        userId: user.id,
        amount: new Prisma.Decimal(50000),
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: "User PPOB"
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("does not credit Basic PPOB after the first 1000 users", async () => {
    // Kuota benefit Basic sudah habis (1.000 penerima). Mekanisme atomik
    // memakai registration_quota.granted, sehingga registrasi berikutnya
    // (user ke-1.001) tidak lagi memperoleh benefit Rp5.000.
    await setRegistrationQuotaGranted(1000);

    const user1001 = await registerUser("PPOB-1001");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user1001.id } });
    expect(decimalString(wallet.balance)).toBe("0.00");
    expect(decimalString(wallet.cashBalance)).toBe("0.00");
    expect(decimalString(wallet.ppobBalance)).toBe("0.00");
  });

  it("credits Silver, Gold, and Platinum PPOB benefits to PPOB balance only", async () => {
    for (const [tier, expected] of [
      ["SILVER", "100000.00"],
      ["GOLD", "600000.00"],
      ["PLATINUM", "1000000.00"]
    ] as Array<[MembershipTier, string]>) {
      const user = await registerUser(`PPOB-${tier}`);
      await payPackage(user, tier);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      expect(decimalString(wallet.balance)).toBe("0.00");
      expect(decimalString(wallet.cashBalance)).toBe("0.00");
      expect(decimalString(wallet.ppobBalance)).toBe(new Prisma.Decimal(expected).plus(5000).toFixed(2));

      await expect(
        walletService.requestWithdrawal({
          userId: user.id,
          amount: new Prisma.Decimal(50000),
          bankName: "BCA",
          accountNumber: "1234567890",
          accountHolderName: "User PPOB"
        })
      ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    }
  });

  it("credits sponsor, level, and profit bonus types to cash wallet", async () => {
    const sponsor = await registerUser("CASH-SPONSOR");
    await activateUserPackage(sponsor.id, "SILVER");
    const buyer = await registerUser("CASH-BUYER", sponsor.referralCode);

    const order = await payPackage(buyer, "SILVER");
    const sponsorWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const sponsorTx = await prisma.walletTransaction.findFirstOrThrow({
      where: { referenceId: order.id, type: "SPONSOR_BONUS" }
    });

    expect(decimalString(sponsorTx.amount)).toBe("40000.00");
    expect(decimalString(sponsorWallet.cashBalance)).toBe("80000.00");
    expect(decimalString(sponsorWallet.balance)).toBe("80000.00");
  });
});

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
    paymentReference: `ppob-wallet-${tier}-${sequence}`
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
