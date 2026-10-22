import { MembershipTier } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MembershipGrantService } from "../../src/modules/memberships/application/MembershipGrantService.js";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import { prisma, registerBasicUser, runIntegration, setupReferralWalletIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Pemberian membership tanpa pembelian (permintaan Owner: Ahmad zulhi menjadi Platinum dengan hak sesuai business
 * engine). Hak harus nyata (tingkat bonus, benefit PPOB, pembagian laba), tetapi tidak ada pembelian palsu: tidak ada
 * order, invoice, pendapatan, atau bonus ke atasan.
 */
const orders = new MembershipOrderService(prisma);
const grants = new MembershipGrantService(prisma, orders);
let sequence = 0;

async function createUser(label: string, sponsorCode?: string) {
  sequence += 1;
  return registerBasicUser(`${label}${sequence}`, sponsorCode);
}

async function wallet(userId: string) {
  return prisma.wallet.findUniqueOrThrow({ where: { userId } });
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  await prisma.userMembership.create({ data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}

describe.skipIf(!runIntegration)("Pemberian membership tanpa pembelian", () => {
  setupReferralWalletIntegration();

  it("simulasi melaporkan hasilnya tanpa mengubah data apa pun", async () => {
    const user = await createUser("GRDRY");
    const before = await wallet(user.id);

    const report = await grants.run({ userId: user.id, tier: "PLATINUM", reason: "uji simulasi pemberian", apply: false });

    expect(report).toMatchObject({ applied: false, previousTier: "BASIC", tier: "PLATINUM", ppobCredited: "1000000.00" });
    expect(report.tierMembersAfter).toBe(report.tierMembersBefore + 1);
    expect(await prisma.userMembership.count({ where: { userId: user.id } })).toBe(0);
    expect((await wallet(user.id)).ppobBalance.toFixed(2)).toBe(before.ppobBalance.toFixed(2));
    const platinumId = (await prisma.membership.findUniqueOrThrow({ where: { tier: "PLATINUM" } })).id;
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).membershipId).not.toBe(platinumId);
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_GRANTED_COMPLIMENTARY" } })).toBe(0);
  });

  it("menerapkan Platinum: keanggotaan aktif, benefit PPOB Rp1.000.000, audit, tanpa order/invoice/komisi", async () => {
    const user = await createUser("GRAPPLY");
    const admin = await createUser("GRADMIN");
    const before = await wallet(user.id);

    await grants.run({ userId: user.id, tier: "PLATINUM", reason: "mitra internal TapGo Lion", adminId: admin.id, apply: true });

    const platinum = await prisma.membership.findUniqueOrThrow({ where: { tier: "PLATINUM" } });
    const active = await prisma.userMembership.findFirstOrThrow({ where: { userId: user.id, status: "ACTIVE" } });
    expect(active.membershipId).toBe(platinum.id);
    expect(active.orderId).toBeNull();
    expect(active.metadata).toMatchObject({ grant: "COMPLIMENTARY", reason: "mitra internal TapGo Lion", grantedBy: admin.id });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).membershipId).toBe(platinum.id);

    const after = await wallet(user.id);
    expect(after.ppobBalance.minus(before.ppobBalance).toFixed(2)).toBe("1000000.00");
    const tx = await prisma.walletTransaction.findFirstOrThrow({ where: { walletId: after.id, type: "PPOB_BENEFIT" } });
    expect(tx.referenceType).toBe("MEMBERSHIP_GRANT");
    expect(tx.referenceId).toBe(active.id);

    expect(await prisma.membershipOrder.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.commission.count({ where: { sourceUserId: user.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBERSHIP_GRANTED_COMPLIMENTARY" } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.entityId).toBe(user.id);
  });

  it("hak Platinum benar-benar berlaku di business engine: bonus sponsor 8% + level 1 8% atas pembelian downline", async () => {
    const sponsor = await createUser("GRSPONS");
    await grants.run({ userId: sponsor.id, tier: "PLATINUM", reason: "uji hak business engine", apply: true });
    const buyer = await createUser("GRBUYER", sponsor.referralCode);

    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const order = await orders.createOrder({ userId: buyer.id, packageId: silver.id, channel: "APP" });
    await orders.markPaymentSuccess({ userId: buyer.id, role: "USER", orderId: order.id, paymentReference: "gr-app" });

    // Sponsor Basic hanya akan menerima Rp2.000; sebagai Platinum: 8% + 8% dari Rp500.000.
    expect((await wallet(sponsor.id)).cashBalance.toFixed(2)).toBe("80000.00");
  });

  it("ikut dihitung sebagai anggota Platinum aktif untuk pembagian laba", async () => {
    const user = await createUser("GRSHARE");
    const rows = async () =>
      (await prisma.userMembership.findMany({ where: { status: "ACTIVE", membership: { tier: "PLATINUM" } }, distinct: ["userId"], select: { userId: true } })).map((r) => r.userId);

    expect(await rows()).not.toContain(user.id);
    await grants.run({ userId: user.id, tier: "PLATINUM", reason: "uji pembagian laba", apply: true });
    expect(await rows()).toContain(user.id);
  });

  it("tidak membayar apa pun ke atasan pemilik akun saat pemberian", async () => {
    const upline = await createUser("GRUP");
    await activateUserPackage(upline.id, "PLATINUM");
    const user = await createUser("GRDOWN", upline.referralCode);
    const uplineBefore = await wallet(upline.id);

    await grants.run({ userId: user.id, tier: "PLATINUM", reason: "uji tanpa bonus atasan", apply: true });

    expect((await wallet(upline.id)).cashBalance.toFixed(2)).toBe(uplineBefore.cashBalance.toFixed(2));
    expect(await prisma.commission.count({ where: { sourceUserId: user.id } })).toBe(0);
  });

  it("mengganti keanggotaan sebelumnya (Gold -> Platinum) dan menolak pemberian yang bukan kenaikan", async () => {
    const user = await createUser("GRGOLD");
    await activateUserPackage(user.id, "GOLD");

    await grants.run({ userId: user.id, tier: "PLATINUM", reason: "naik dari Gold oleh Owner", apply: true });

    const memberships = await prisma.userMembership.findMany({ where: { userId: user.id }, include: { membership: true } });
    expect(memberships.filter((m) => m.status === "ACTIVE").map((m) => m.membership.tier)).toEqual(["PLATINUM"]);
    expect(memberships.find((m) => m.membership.tier === "GOLD")?.status).toBe("EXPIRED");

    await expect(grants.run({ userId: user.id, tier: "PLATINUM", reason: "pemberian ulang", apply: true })).rejects.toMatchObject({
      code: "MEMBERSHIP_GRANT_NOT_AN_UPGRADE"
    });
    await expect(grants.run({ userId: user.id, tier: "SILVER", reason: "turun tingkat", apply: true })).rejects.toMatchObject({
      code: "MEMBERSHIP_GRANT_NOT_AN_UPGRADE"
    });
    expect(await prisma.walletTransaction.count({ where: { referenceType: "MEMBERSHIP_GRANT" } })).toBe(1);
  });
});
