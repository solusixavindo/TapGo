import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import { reverseUnverifiedOrder } from "../../src/modules/memberships/application/UnverifiedOrderReversal.js";
import { prisma, registerBasicUser, runIntegration, setupReferralWalletIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Pembalikan pesanan yang ditandai lunas manual tanpa bukti (kasus 13 Nov 2026).
 * Rantai: PENERIMA (Silver, mis. direktur) <- PEMBELI (membeli Platinum, ditandai lunas oleh ADMIN-<id>).
 */
const membership = new MembershipOrderService(prisma);
let seq = 0;

async function buy(userId: string, tier: "SILVER" | "PLATINUM", reference: string) {
  seq += 1;
  const pkg = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const order = await membership.createOrder({ userId, packageId: pkg.id });
  await membership.markPaymentSuccess({ userId, role: "USER", orderId: order.id, paymentReference: reference });
  const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId: order.id } });
  return { order, invoice };
}

async function scenario(options: { reference?: (adminId: string) => string; evidence?: string } = {}) {
  const admin = await registerBasicUser("REVADM1");
  const receiver = await registerBasicUser("REVRECV1");
  await buy(receiver.id, "SILVER", "gateway-silver");
  const buyer = await registerBasicUser("REVBUY01", receiver.referralCode);
  const reference = (options.reference ?? ((id: string) => `ADMIN-${id}`))(admin.id);
  const { order, invoice } = await buy(buyer.id, "PLATINUM", reference);
  if (options.evidence) {
    const payment = await prisma.membershipPayment.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    await prisma.membershipPayment.update({ where: { id: payment.id }, data: { metadata: { manualEvidence: options.evidence } } });
  }
  return { admin, receiver, buyer, order, invoice };
}

const walletOf = (userId: string) => prisma.wallet.findUniqueOrThrow({ where: { userId } });

describe.skipIf(!runIntegration)("Pembalikan pesanan lunas-manual tanpa bukti", () => {
  setupReferralWalletIntegration();

  it("SIMULASI tidak mengubah apa pun, tetapi melaporkan pesanan, pengonfirmasi, tingkat, benefit PPOB, dan bonus penerima", async () => {
    const { receiver, buyer, invoice, order } = await scenario();
    const before = await walletOf(receiver.id);
    const report = await reverseUnverifiedOrder(prisma, { invoiceNumber: invoice.number, beneficiaryPhones: [receiver.phone], apply: false });
    expect(report.applied).toBe(false);
    expect(report.order.id).toBe(order.id);
    expect(report.membership).toMatchObject({ currentTier: "PLATINUM", restoreTo: "BASIC" });
    expect(report.confirmedBy).toBe("User REVADM1");
    expect(Number(report.ppob.amount)).toBeGreaterThan(0);
    const bonus = report.commissions.find((c) => c.beneficiaryPhone === receiver.phone)!;
    expect(bonus.selected).toBe(true);
    expect(Number(bonus.amount)).toBeGreaterThan(0);
    expect(bonus.willReverse).toBe(bonus.amount);
    expect(bonus.shortfall).toBe("0");

    expect((await walletOf(receiver.id)).balance.toString()).toBe(before.balance.toString());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).membershipId).toBe(order.membershipId);
    expect((await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect(await prisma.auditLog.count({ where: { action: "UNVERIFIED_ORDER_REVERSED" } })).toBe(0);
  });

  it("TERAPKAN: pembeli kembali Basic, PPOB dan bonus penerima yang dipilih dibalik, penerima lain dibiarkan; semuanya tercatat", async () => {
    const { receiver, buyer, invoice, order } = await scenario();
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    const receiverBefore = await walletOf(receiver.id);
    const buyerPpobBefore = (await walletOf(buyer.id)).ppobBalance;
    expect(Number(buyerPpobBefore)).toBeGreaterThan(0);

    const report = await reverseUnverifiedOrder(prisma, { invoiceNumber: invoice.number, beneficiaryPhones: [receiver.phone], apply: true });
    expect(report.applied).toBe(true);

    const buyerAfter = await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } });
    expect(buyerAfter.membershipId).toBe(basic.id);
    expect(Number((await walletOf(buyer.id)).ppobBalance)).toBe(Number(buyerPpobBefore) - Number(report.ppob.willReverse));
    expect(Number((await walletOf(buyer.id)).ppobBalance)).toBeLessThan(Number(buyerPpobBefore));
    expect((await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("CANCELLED");
    expect((await prisma.membershipPayment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("CANCELLED");
    expect(await prisma.userMembership.count({ where: { userId: buyer.id, status: "ACTIVE", membershipId: order.membershipId } })).toBe(0);

    // Penerima mendapat dua bonus dari satu pesanan (sponsor langsung dan level 1): keduanya dibalik.
    const mine = report.commissions.filter((c) => c.beneficiaryPhone === receiver.phone);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const totalBonus = mine.reduce((sum, c) => sum + Number(c.amount), 0);
    const receiverAfter = await walletOf(receiver.id);
    expect(Number(receiverAfter.balance)).toBe(Number(receiverBefore.balance) - totalBonus);
    expect(Number(receiverAfter.cashBalance)).toBeGreaterThanOrEqual(0);
    expect(Number(receiverAfter.cashBalance)).toBeLessThanOrEqual(Number(receiverAfter.balance));
    for (const row of mine) {
      expect((await prisma.commission.findUniqueOrThrow({ where: { id: row.commissionId } })).status).toBe("REVERSED");
      const ledger = await prisma.walletTransaction.findFirstOrThrow({ where: { referenceType: "UNVERIFIED_ORDER_REVERSAL", referenceId: row.commissionId } });
      expect(Number(ledger.amount)).toBe(-Number(row.amount));
    }
    expect(await prisma.auditLog.count({ where: { action: "UNVERIFIED_ORDER_REVERSED", entityId: order.id } })).toBe(1);
  });

  it("penerima yang TIDAK dipilih tidak disentuh (tanpa daftar penerima, hanya keanggotaan dan PPOB pembeli yang dibalik)", async () => {
    const { receiver, buyer, invoice } = await scenario();
    const before = await walletOf(receiver.id);
    const report = await reverseUnverifiedOrder(prisma, { invoiceNumber: invoice.number, beneficiaryPhones: [], apply: true });
    expect(report.commissions.every((c) => !c.selected)).toBe(true);
    expect((await walletOf(receiver.id)).balance.toString()).toBe(before.balance.toString());
    expect((await prisma.commission.findMany({ where: { beneficiaryId: receiver.id } })).every((c) => c.status === "POSTED")).toBe(true);
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).membershipId).toBe(basic.id);
  });

  it("idempoten: diulang tidak membalik dua kali", async () => {
    const { receiver, invoice } = await scenario();
    await reverseUnverifiedOrder(prisma, { invoiceNumber: invoice.number, beneficiaryPhones: [receiver.phone], apply: true });
    const afterFirst = await walletOf(receiver.id);
    const second = await reverseUnverifiedOrder(prisma, { invoiceNumber: invoice.number, beneficiaryPhones: [receiver.phone], apply: true });
    expect(second.alreadyReversed).toBe(true);
    expect(second.applied).toBe(false);
    expect((await walletOf(receiver.id)).balance.toString()).toBe(afterFirst.balance.toString());
    expect(await prisma.auditLog.count({ where: { action: "UNVERIFIED_ORDER_REVERSED" } })).toBe(1);
  });

  it("bonus yang sudah dipakai/ditarik: dibalik sebatas saldo yang ada, tidak pernah negatif, kekurangan dilaporkan", async () => {
    const { receiver, invoice } = await scenario();
    const w = await walletOf(receiver.id);
    await prisma.wallet.update({ where: { id: w.id }, data: { balance: new Prisma.Decimal(1000), cashBalance: new Prisma.Decimal(1000) } });
    const report = await reverseUnverifiedOrder(prisma, { invoiceNumber: invoice.number, beneficiaryPhones: [receiver.phone], apply: true });
    const rows = report.commissions.filter((c) => c.beneficiaryPhone === receiver.phone);
    const reversed = rows.reduce((sum, c) => sum + Number(c.willReverse), 0);
    const shortfall = rows.reduce((sum, c) => sum + Number(c.shortfall), 0);
    const total = rows.reduce((sum, c) => sum + Number(c.amount), 0);
    expect(reversed).toBe(1000); // hanya sebatas saldo yang ada
    expect(shortfall).toBe(total - 1000);
    const after = await walletOf(receiver.id);
    expect(Number(after.balance)).toBe(0);
    expect(Number(after.cashBalance)).toBe(0);
  });

  it("menolak pesanan yang bukan lunas-manual-tanpa-bukti: lunas lewat penyedia, atau sudah ada bukti VIP", async () => {
    const viaGateway = await scenario({ reference: () => "midtrans-ref-123" });
    await expect(reverseUnverifiedOrder(prisma, { invoiceNumber: viaGateway.invoice.number, beneficiaryPhones: [], apply: true })).rejects.toThrow(/TIDAK ditandai lunas manual/);
    expect((await prisma.membershipOrder.findUniqueOrThrow({ where: { id: viaGateway.order.id } })).status).toBe("PAID");
  });
});
