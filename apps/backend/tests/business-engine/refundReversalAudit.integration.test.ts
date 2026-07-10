import { Prisma, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AdminConsoleService } from "../../src/modules/admin-console/application/AdminConsoleService.js";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  decimalString,
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration,
  walletService
} from "../helpers/referralWalletHarness.js";

const membershipService = new MembershipOrderService(prisma);
const adminConsoleService = new AdminConsoleService(prisma);
let sequence = 0;

describe.skipIf(!runIntegration)("Refund and reversal safety audit", () => {
  setupReferralWalletIntegration();

  it("does not allow rejecting a paid and approved membership order without an explicit reversal flow", async () => {
    const admin = await createAdmin("REVERSAL-ADMIN");
    const user = await registerUser("REVERSAL-BUYER");
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const order = await membershipService.createOrder({ userId: user.id, packageId: silver.id });
    await membershipService.markPaymentSuccess({ userId: user.id, role: "USER", orderId: order.id });

    await expect(
      adminConsoleService.rejectMemberRequest({ orderId: order.id, adminId: admin.id, reason: "late reject" })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REQUEST_INVALID_STATE" });

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(invoice.status).toBe("PAID");
    expect(decimalString(wallet.ppobBalance)).toBe("105000.00");
  });

  it("refunds reserved withdrawal exactly once and blocks duplicate reversal", async () => {
    const admin = await createAdmin("WITHDRAW-ADMIN");
    const user = await registerUser("WITHDRAW-USER");
    await creditCash(user.id, "100000.00");

    const withdrawal = await walletService.requestWithdrawal({
      userId: user.id,
      amount: new Prisma.Decimal(50000),
      bankName: "BCA",
      accountNumber: "1234567890",
      accountHolderName: "Withdrawal User"
    });
    await walletService.rejectWithdrawal({ withdrawalId: withdrawal.id, adminId: admin.id, note: "audit reject" });
    await expect(
      walletService.rejectWithdrawal({ withdrawalId: withdrawal.id, adminId: admin.id, note: "duplicate reject" })
    ).rejects.toMatchObject({ code: "WITHDRAWAL_INVALID_STATE" });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    const refunds = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "WITHDRAWAL_REFUND", referenceId: withdrawal.id }
    });

    expect(decimalString(wallet.cashBalance)).toBe("100000.00");
    expect(decimalString(wallet.balance)).toBe("100000.00");
    expect(refunds).toHaveLength(1);
  });
});

async function registerUser(label: string) {
  sequence += 1;
  return registerBasicUser(`${label}${sequence}`.replace(/[^A-Z0-9]/gi, "").slice(0, 20).toUpperCase());
}

async function createAdmin(label: string): Promise<User> {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: label,
      phone: `+62855${String(sequence).padStart(8, "0")}`,
      referralCode: `${label}${sequence}`.replace(/[^A-Z0-9]/gi, "").slice(0, 20).toUpperCase(),
      role: "SUPER_ADMIN"
    }
  });
}

async function creditCash(userId: string, amount: string) {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    update: {
      cashBalance: { increment: new Prisma.Decimal(amount) },
      balance: { increment: new Prisma.Decimal(amount) }
    },
    create: {
      userId,
      cashBalance: new Prisma.Decimal(amount),
      balance: new Prisma.Decimal(amount),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }
  });
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "ADJUSTMENT",
      amount: new Prisma.Decimal(amount),
      referenceType: "REFUND_REVERSAL_AUDIT",
      referenceId: userId
    }
  });
}
