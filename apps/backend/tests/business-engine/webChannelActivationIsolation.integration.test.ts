import { MembershipOrderChannel, MembershipTier, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

/// Bukti isolasi Business Engine untuk Stage R2.6 jalur A.
///
/// Aturan barunya hanya satu: order yang berasal dari kanal WEB tidak boleh
/// aktif hanya karena pembayarannya lunas — aktivasi menunggu admin memverifikasi
/// dokumen KYC. Semua kanal lain (APP, ADMIN, dan order lama yang kanalnya null)
/// harus berperilaku persis seperti sebelumnya.
///
/// File ini sengaja menguji ketiga kanal berdampingan dengan skenario finansial
/// yang identik, supaya perubahan yang tidak sengaja membocorkan aturan WEB ke
/// kanal lain langsung terlihat sebagai kegagalan test.

const service = new MembershipOrderService(prisma);
let userSequence = 0;

describe.skipIf(!runIntegration)("Web channel activation isolation", () => {
  setupReferralWalletIntegration();

  it("keeps legacy orders without a channel activating and paying the business engine in full", async () => {
    const scenario = await buildScenario(undefined);
    await service.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.order.id,
      paymentReference: "isolation-legacy"
    });

    await expectFullyActivated(scenario);
  });

  it("keeps app channel orders activating and paying the business engine in full", async () => {
    const scenario = await buildScenario("APP");
    await service.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.order.id,
      paymentReference: "isolation-app"
    });

    await expectFullyActivated(scenario);
  });

  it("settles a web channel payment without activating membership or paying the business engine", async () => {
    const scenario = await buildScenario("WEB");
    const result = await service.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.order.id,
      paymentReference: "isolation-web"
    });

    // Uang tetap tercatat masuk: order, invoice, dan payment semuanya lunas.
    expect(result.status).toBe("PAID");
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: scenario.order.id } });
    expect(invoice.status).toBe("PAID");
    const payment = await prisma.membershipPayment.findFirstOrThrow({ where: { orderId: scenario.order.id } });
    expect(payment.status).toBe("PAID");
    expect(payment.providerReference).toBe("isolation-web");

    // Namun tidak ada satu pun efek Business Engine yang terjadi.
    await expectNoBusinessEngineEffect(scenario);
  });

  it("pays the identical business engine matrix once an admin verifies the web order", async () => {
    const webScenario = await buildScenario("WEB");
    await service.markPaymentSuccess({
      userId: webScenario.buyer.id,
      role: "USER",
      orderId: webScenario.order.id,
      paymentReference: "isolation-web-verified"
    });
    await service.activateVerifiedOrder({ orderId: webScenario.order.id, adminId: webScenario.admin.id });

    const appScenario = await buildScenario("APP");
    await service.markPaymentSuccess({
      userId: appScenario.buyer.id,
      role: "USER",
      orderId: appScenario.order.id,
      paymentReference: "isolation-app-baseline"
    });

    await expectFullyActivated(webScenario);
    expect(await payoutMatrix(webScenario)).toEqual(await payoutMatrix(appScenario));
  });

  it("records who verified the web order and when", async () => {
    const scenario = await buildScenario("WEB");
    await service.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.order.id,
      paymentReference: "isolation-web-audit"
    });
    await service.activateVerifiedOrder({ orderId: scenario.order.id, adminId: scenario.admin.id });

    const order = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: scenario.order.id } });
    const registrationData = order.registrationData as Record<string, unknown>;
    const verification = registrationData.documentVerification as Record<string, unknown>;

    expect(verification.verifiedBy).toBe(scenario.admin.id);
    expect(typeof verification.verifiedAt).toBe("string");
  });

  it("refuses a second verification so the business engine is never paid twice", async () => {
    const scenario = await buildScenario("WEB");
    await service.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.order.id,
      paymentReference: "isolation-web-double"
    });
    await service.activateVerifiedOrder({ orderId: scenario.order.id, adminId: scenario.admin.id });

    await expect(
      service.activateVerifiedOrder({ orderId: scenario.order.id, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_ALREADY_ACTIVATED" });

    await expectFullyActivated(scenario);
  });

  it("refuses verification before the web payment has settled", async () => {
    const scenario = await buildScenario("WEB");

    await expect(
      service.activateVerifiedOrder({ orderId: scenario.order.id, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_ORDER_NOT_PAID" });

    await expectNoBusinessEngineEffect(scenario);
  });

  it("refuses verification for channels that activate on payment", async () => {
    const scenario = await buildScenario("APP");
    await service.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.order.id,
      paymentReference: "isolation-app-verify"
    });

    await expect(
      service.activateVerifiedOrder({ orderId: scenario.order.id, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_VERIFICATION_NOT_REQUIRED" });

    await expectFullyActivated(scenario);
  });
});

type Scenario = {
  sponsor: User;
  buyer: User;
  admin: User;
  order: { id: string };
  silverMembershipId: string;
};

async function buildScenario(channel: MembershipOrderChannel | undefined): Promise<Scenario> {
  const sponsor = await createUser("ISOSPONSOR");
  await activateUserPackage(sponsor.id, "PLATINUM");
  const buyer = await createUser("ISOBUYER");
  const admin = await createUser("ISOADMIN");
  await createDirectReferral(sponsor.id, buyer.id);

  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await service.createOrder({
    userId: buyer.id,
    packageId: silver.id,
    ...(channel ? { channel } : {})
  });

  return { sponsor, buyer, admin, order, silverMembershipId: silver.id };
}

/// Efek lengkap satu pembelian Silver Rp500.000 oleh anggota yang disponsori
/// upline Platinum: membership aktif, PPOB bertambah Rp100.000, sponsor menerima
/// SPONSOR_BONUS 8% dan LEVEL_BONUS level 1 8%.
async function expectFullyActivated(scenario: Scenario) {
  const userMembership = await prisma.userMembership.findUniqueOrThrow({
    where: { orderId: scenario.order.id }
  });
  expect(userMembership.status).toBe("ACTIVE");
  expect(userMembership.membershipId).toBe(scenario.silverMembershipId);

  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: scenario.buyer.id } });
  expect(buyer.membershipId).toBe(scenario.silverMembershipId);

  const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: scenario.buyer.id } });
  // Rp5.000 bonus registrasi Basic + Rp100.000 benefit paket Silver.
  expect(buyerWallet.ppobBalance.toFixed(2)).toBe("105000.00");

  const sponsorWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: scenario.sponsor.id } });
  // SPONSOR_BONUS 8% + LEVEL_BONUS level 1 8% dari Rp500.000.
  expect(sponsorWallet.cashBalance.toFixed(2)).toBe("80000.00");

  expect(await payoutMatrix(scenario)).toEqual([
    { type: "LEVEL_BONUS", level: 1, amount: "40000.00" },
    { type: "SPONSOR_BONUS", level: 1, amount: "40000.00" }
  ]);
}

async function expectNoBusinessEngineEffect(scenario: Scenario) {
  expect(await prisma.userMembership.findUnique({ where: { orderId: scenario.order.id } })).toBeNull();

  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: scenario.buyer.id } });
  expect(buyer.membershipId).not.toBe(scenario.silverMembershipId);

  const buyerWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: scenario.buyer.id } });
  // Hanya bonus registrasi Basic; benefit PPOB paket belum dikreditkan.
  expect(buyerWallet.ppobBalance.toFixed(2)).toBe("5000.00");

  const sponsorWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: scenario.sponsor.id } });
  expect(sponsorWallet.cashBalance.toFixed(2)).toBe("0.00");

  expect(await payoutMatrix(scenario)).toEqual([]);
  expect(
    await prisma.walletTransaction.count({
      where: { referenceType: "MEMBERSHIP_ORDER", referenceId: scenario.order.id }
    })
  ).toBe(0);
  expect(await prisma.rewardTransaction.count({ where: { userId: scenario.sponsor.id } })).toBe(0);
}

async function payoutMatrix(scenario: Scenario) {
  const commissions = await prisma.commission.findMany({
    where: { triggerType: "MEMBERSHIP_ORDER", triggerId: scenario.order.id }
  });

  // Postgres mengurutkan enum sesuai urutan deklarasinya, bukan abjad. Urutkan
  // di sisi test supaya perbandingan antar-kanal stabil.
  return commissions
    .map((commission) => ({
      type: commission.type,
      level: commission.level ?? 0,
      amount: commission.amount.toFixed(2)
    }))
    .sort((left, right) => left.type.localeCompare(right.type) || left.level - right.level);
}

async function createUser(label: string) {
  userSequence += 1;
  return registerBasicUser(`${label}${userSequence}`);
}

async function createDirectReferral(sponsorId: string, userId: string) {
  await prisma.referral.create({ data: { sponsorId, userId } });
  await prisma.referralLevel.create({ data: { ancestorId: sponsorId, descendantId: userId, level: 1 } });
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  await prisma.userMembership.create({
    data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}
