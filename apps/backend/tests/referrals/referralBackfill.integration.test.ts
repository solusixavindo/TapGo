import { MembershipOrderChannel, MembershipTier, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import { ReferralBackfillService } from "../../src/modules/referrals/application/ReferralBackfillService.js";
import { ReferralService } from "../../src/modules/referrals/application/ReferralService.js";
import { PrismaReferralRepository } from "../../src/modules/referrals/infrastructure/PrismaReferralRepository.js";
import {
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

/**
 * Koreksi referral satu kali dan aturan klaim sponsor.
 *
 * Kasus nyata (22 Okt 2026): pembeli membayar membership TANPA sponsor tercatat karena kode referral tidak pernah
 * sampai ke sistem. Koreksi harus (1) mengaitkan sponsor, (2) membayar bonus dengan aturan yang sama persis dengan
 * aktivasi, (3) tidak pernah membayar dobel, (4) menyisakan simulasi yang tidak mengubah apa pun.
 */
const orders = new MembershipOrderService(prisma);
const repository = new PrismaReferralRepository(prisma);
const backfill = new ReferralBackfillService(prisma, orders, repository);
const referrals = new ReferralService(repository);
let sequence = 0;

describe.skipIf(!runIntegration)("Koreksi referral dan aturan klaim", () => {
  setupReferralWalletIntegration();

  it("simulasi tidak mengubah data apa pun, tetapi melaporkan bonus yang akan dibayar", async () => {
    const s = await buildPaidScenario("BASIC");

    const report = await backfill.run({ ...s.input, apply: false });

    expect(report.applied).toBe(false);
    expect(report.payouts).toEqual([
      expect.objectContaining({ beneficiaryId: s.sponsor.id, type: "BASIC_SPONSOR_BONUS", amount: "2000.00" })
    ]);
    expect(report.totalPayout).toBe("2000.00");

    expect(await prisma.referral.count({ where: { userId: s.buyer.id } })).toBe(0);
    expect(await prisma.referralLevel.count({ where: { descendantId: s.buyer.id } })).toBe(0);
    expect(await commissionTotal(s.order.id)).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "REFERRAL_BACKFILL_APPLIED" } })).toBe(0);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: s.sponsor.id } })).cashBalance.toFixed(2)).toBe("0.00");
  });

  it("sponsor Basic: menerima bonus tetap Rp2.000, referral tercatat, audit dibuat", async () => {
    const s = await buildPaidScenario("BASIC");

    const report = await backfill.run({ ...s.input, apply: true, adminId: s.admin.id });

    expect(report.applied).toBe(true);
    expect(report.totalPayout).toBe("2000.00");
    const referral = await prisma.referral.findUniqueOrThrow({ where: { userId: s.buyer.id } });
    expect(referral.sponsorId).toBe(s.sponsor.id);
    expect(referral.status).toBe("ACTIVE");
    expect(referral.metadata).toMatchObject({ source: "admin_backfill", orderId: s.order.id, adminId: s.admin.id });
    expect(await prisma.referralLevel.count({ where: { ancestorId: s.sponsor.id, descendantId: s.buyer.id, level: 1 } })).toBe(1);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: s.sponsor.id } })).cashBalance.toFixed(2)).toBe("2000.00");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "REFERRAL_BACKFILL_APPLIED" } });
    expect(audit.actorId).toBe(s.admin.id);
    expect(audit.entityId).toBe(s.order.id);
  });

  it("sponsor Platinum: bonus sponsor 8% dan bonus level 1 sama persis dengan aktivasi normal", async () => {
    const s = await buildPaidScenario("PLATINUM");

    await backfill.run({ ...s.input, apply: true });

    expect(await payoutMatrix(s.order.id)).toEqual([
      { type: "LEVEL_BONUS", level: 1, amount: "40000.00" },
      { type: "SPONSOR_BONUS", level: 1, amount: "40000.00" }
    ]);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: s.sponsor.id } })).cashBalance.toFixed(2)).toBe("80000.00");
  });

  it("tidak pernah membayar dobel: pemanggilan kedua ditolak dan saldo tetap", async () => {
    const s = await buildPaidScenario("PLATINUM");
    await backfill.run({ ...s.input, apply: true });

    await expect(backfill.run({ ...s.input, apply: true })).rejects.toMatchObject({ code: "BACKFILL_ALREADY_PAID" });
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: s.sponsor.id } })).cashBalance.toFixed(2)).toBe("80000.00");
    expect(await prisma.auditLog.count({ where: { action: "REFERRAL_BACKFILL_APPLIED" } })).toBe(1);
  });

  it("order yang sponsornya sudah ada saat dibeli (bonus sudah dibayar) ditolak", async () => {
    const sponsor = await createUser("BFPAIDSP");
    await activateUserPackage(sponsor.id, "PLATINUM");
    const buyer = await createUser("BFPAIDBY");
    await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: buyer.id } });
    await prisma.referralLevel.create({ data: { ancestorId: sponsor.id, descendantId: buyer.id, level: 1 } });
    const order = await buyAndActivate(buyer.id, "WEB");

    await expect(
      backfill.run({ userId: buyer.id, sponsorCode: sponsor.referralCode, orderId: order.id, apply: true })
    ).rejects.toMatchObject({ code: "BACKFILL_ALREADY_PAID" });
  });

  it("menolak order milik akun lain, order yang belum lunas dan aktif, dan kode yang tidak sah", async () => {
    const s = await buildPaidScenario("BASIC");
    const other = await createUser("BFOTHER");
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const unpaid = await orders.createOrder({ userId: s.buyer.id, packageId: silver.id, channel: "WEB" });

    await expect(backfill.run({ ...s.input, userId: other.id, apply: true })).rejects.toMatchObject({
      code: "BACKFILL_ORDER_NOT_FOUND"
    });
    await expect(backfill.run({ ...s.input, orderId: unpaid.id, apply: true })).rejects.toMatchObject({
      code: "BACKFILL_ORDER_NOT_ACTIVATED"
    });
    await expect(backfill.run({ ...s.input, sponsorCode: "TIDAKADA999", apply: true })).rejects.toMatchObject({
      code: "SPONSOR_NOT_FOUND"
    });
    expect(await prisma.referral.count({ where: { userId: s.buyer.id } })).toBe(0);
    expect(await commissionTotal(s.order.id)).toBe(0);
  });

  it("menolak referral diri sendiri, referral yang sudah ada, dan referral melingkar", async () => {
    const s = await buildPaidScenario("BASIC");

    await expect(backfill.run({ ...s.input, sponsorCode: s.buyer.referralCode, apply: true })).rejects.toMatchObject({
      code: "SELF_REFERRAL_BLOCKED"
    });

    // Sponsor yang justru downline pembeli: akan membentuk lingkaran.
    await prisma.referral.create({ data: { sponsorId: s.buyer.id, userId: s.sponsor.id } });
    await prisma.referralLevel.create({ data: { ancestorId: s.buyer.id, descendantId: s.sponsor.id, level: 1 } });
    await expect(backfill.run({ ...s.input, apply: true })).rejects.toMatchObject({ code: "CIRCULAR_REFERRAL_BLOCKED" });

    // Pembeli sudah punya sponsor lain.
    const third = await createUser("BFTHIRD");
    await prisma.referral.create({ data: { sponsorId: third.id, userId: s.buyer.id } });
    await expect(backfill.run({ ...s.input, apply: true })).rejects.toMatchObject({ code: "REFERRAL_ALREADY_CLAIMED" });

    expect(await commissionTotal(s.order.id)).toBe(0);
  });

  describe("klaim sponsor lewat jalur biasa", () => {
    it("diterima sebelum membership berbayar pertama dan kode huruf kecil tetap sah", async () => {
      const sponsor = await createUser("CLSP");
      const buyer = await createUser("CLBY");

      await referrals.claimReferral({
        userId: buyer.id,
        sponsorCode: sponsor.referralCode.toLowerCase(),
        triggerType: "REFERRAL_JOIN",
        triggerId: "t",
        baseAmount: 0 as never
      });

      expect((await prisma.referral.findUniqueOrThrow({ where: { userId: buyer.id } })).sponsorId).toBe(sponsor.id);
    });

    it("ditolak setelah akun pernah membayar membership", async () => {
      const s = await buildPaidScenario("BASIC");

      await expect(
        referrals.claimReferral({
          userId: s.buyer.id,
          sponsorCode: s.sponsor.referralCode,
          triggerType: "REFERRAL_JOIN",
          triggerId: "t",
          baseAmount: 0 as never
        })
      ).rejects.toMatchObject({ code: "REFERRAL_AFTER_PURCHASE_BLOCKED" });
      expect(await prisma.referral.count({ where: { userId: s.buyer.id } })).toBe(0);
    });

    it("order yang masih menunggu pembayaran tidak menutup klaim", async () => {
      const sponsor = await createUser("CLSP2");
      const buyer = await createUser("CLBY2");
      const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
      await orders.createOrder({ userId: buyer.id, packageId: silver.id, channel: "WEB" });

      await referrals.claimReferral({
        userId: buyer.id,
        sponsorCode: sponsor.referralCode,
        triggerType: "REFERRAL_JOIN",
        triggerId: "t",
        baseAmount: 0 as never
      });
      expect(await prisma.referral.count({ where: { userId: buyer.id } })).toBe(1);
    });
  });
});

type Scenario = {
  sponsor: User;
  buyer: User;
  admin: User;
  order: { id: string };
  input: { userId: string; sponsorCode: string; orderId: string };
};

/** Pembeli Silver (Rp500.000) lewat kanal WEB yang sudah lunas dan diverifikasi, TANPA sponsor tercatat. */
async function buildPaidScenario(sponsorTier: MembershipTier): Promise<Scenario> {
  const sponsor = await createUser("BFSPONSOR");
  if (sponsorTier !== "BASIC") {
    await activateUserPackage(sponsor.id, sponsorTier);
  }
  const buyer = await createUser("BFBUYER");
  const admin = await createUser("BFADMIN");
  const order = await buyAndActivate(buyer.id, "WEB", admin.id);
  return {
    sponsor,
    buyer,
    admin,
    order,
    input: { userId: buyer.id, sponsorCode: sponsor.referralCode, orderId: order.id }
  };
}

async function buyAndActivate(userId: string, channel: MembershipOrderChannel, adminId?: string) {
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await orders.createOrder({ userId, packageId: silver.id, channel });
  await orders.markPaymentSuccess({ userId, role: "USER", orderId: order.id, paymentReference: `bf-${order.id}` });
  if (channel === "WEB") {
    const verifier = adminId ?? (await createUser("BFVERIFIER")).id;
    await orders.activateVerifiedOrder({ orderId: order.id, adminId: verifier });
  }
  return order;
}

async function commissionTotal(orderId: string) {
  return prisma.commission.count({ where: { triggerType: "MEMBERSHIP_ORDER", triggerId: orderId } });
}

async function payoutMatrix(orderId: string) {
  const commissions = await prisma.commission.findMany({ where: { triggerType: "MEMBERSHIP_ORDER", triggerId: orderId } });
  return commissions
    .map((commission) => ({ type: commission.type, level: commission.level ?? 0, amount: commission.amount.toFixed(2) }))
    .sort((left, right) => left.type.localeCompare(right.type) || left.level - right.level);
}

async function createUser(label: string) {
  sequence += 1;
  return registerBasicUser(`${label}${sequence}`);
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  await prisma.userMembership.create({
    data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}
