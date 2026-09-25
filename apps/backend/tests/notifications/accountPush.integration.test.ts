import { Prisma, User, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";
import type { PushNotifier } from "../../src/modules/notifications/application/rideNotifications.js";
import type { PushMessage } from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Push untuk saldo (top up, transfer) dan membership (bayar, aktif, ditolak):
 * terkirim sekali per kejadian nyata, tanpa nominal/nama, dan tidak pernah
 * mengubah hasil transaksi walau pengirim gagal.
 */
const MIDTRANS_KEY = "test-midtrans-server-key-account-push";
let sequence = 0;

class RecordingPush implements PushNotifier {
  enabled = true;
  failWith: Error | null = null;
  sent: Array<{ userId: string; message: PushMessage }> = [];
  async notifyUser(userId: string, message: PushMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ userId, message });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

let WalletService: typeof import("../../src/modules/wallets/application/WalletService.js").WalletService;
let PrismaWalletRepository: typeof import("../../src/modules/wallets/infrastructure/PrismaWalletRepository.js").PrismaWalletRepository;
let WalletTopUpPaymentService: typeof import("../../src/modules/wallets/application/WalletTopUpPaymentService.js").WalletTopUpPaymentService;
let MembershipOrderService: typeof import("../../src/modules/memberships/application/MembershipOrderService.js").MembershipOrderService;

describe.skipIf(!runIntegration)("Push notifikasi saldo dan membership", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "account-push-access-secret-0000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "account-push-refresh-secret-000000";
    process.env.MIDTRANS_SERVER_KEY = MIDTRANS_KEY;
    const envModule = await import("../../src/config/env.js");
    envModule.env.MIDTRANS_SERVER_KEY = MIDTRANS_KEY;
    ({ WalletService } = await import("../../src/modules/wallets/application/WalletService.js"));
    ({ PrismaWalletRepository } = await import("../../src/modules/wallets/infrastructure/PrismaWalletRepository.js"));
    ({ WalletTopUpPaymentService } = await import("../../src/modules/wallets/application/WalletTopUpPaymentService.js"));
    ({ MembershipOrderService } = await import("../../src/modules/memberships/application/MembershipOrderService.js"));
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  // ---- Transfer ---------------------------------------------------------
  it("transfer: penerima diberi tahu sekali, replay tidak menggandakan, tanpa nominal atau nama", async () => {
    const sender = await createUser("PUSHSEND", "USER", "500000.00");
    const recipient = await createUser("PUSHRECV", "USER", "0.00");
    const push = new RecordingPush();
    const service = new WalletService(new PrismaWalletRepository(prisma), push);
    const input = {
      fromUserId: sender.id,
      recipientPhone: recipient.phone,
      amount: new Prisma.Decimal(123456),
      idempotencyKey: "push-transfer-1"
    };

    const first = await service.transfer(input);
    const replay = await service.transfer(input);
    await flush();

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.userId).toBe(recipient.id);
    expect(push.sent[0]!.message.title).toBe("Saldo masuk");
    const text = JSON.stringify(push.sent[0]!.message);
    expect(text).not.toContain("123456");
    expect(text).not.toContain(sender.fullName);
  });

  it("transfer yang ditolak (saldo kurang) tidak mengirim notifikasi", async () => {
    const sender = await createUser("PUSHPOOR", "USER", "20000.00");
    const recipient = await createUser("PUSHGET2", "USER", "0.00");
    const push = new RecordingPush();
    const service = new WalletService(new PrismaWalletRepository(prisma), push);
    await expect(
      service.transfer({
        fromUserId: sender.id,
        recipientPhone: recipient.phone,
        amount: new Prisma.Decimal(100000),
        idempotencyKey: "push-transfer-2"
      })
    ).rejects.toBeDefined();
    await flush();
    expect(push.sent).toHaveLength(0);
  });

  it("transfer tetap berhasil walau pengirim push gagal", async () => {
    const sender = await createUser("PUSHSND3", "USER", "500000.00");
    const recipient = await createUser("PUSHRCV3", "USER", "0.00");
    const push = new RecordingPush();
    push.failWith = new Error("fcm down");
    const service = new WalletService(new PrismaWalletRepository(prisma), push);
    const result = await service.transfer({
      fromUserId: sender.id,
      recipientPhone: recipient.phone,
      amount: new Prisma.Decimal(50000),
      idempotencyKey: "push-transfer-3"
    });
    await flush();
    expect(result.replayed).toBe(false);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: recipient.id } });
    expect(wallet.balance.toFixed(2)).toBe("50000.00");
  });

  // ---- Top up -----------------------------------------------------------
  it("top up: notifikasi sekali saat saldo bertambah; callback ulang dan callback gagal diam", async () => {
    const user = await createUser("PUSHTOP1", "USER", "0.00");
    const order = await prisma.walletTopUpOrder.create({
      data: { userId: user.id, reference: `WTU-PUSH-${++sequence}`, amount: new Prisma.Decimal(200000) }
    });
    const push = new RecordingPush();
    const service = new WalletTopUpPaymentService(prisma, undefined, undefined, push);

    await service.handleMidtransNotification(settlement(order.reference, "200000.00"));
    await service.handleMidtransNotification(settlement(order.reference, "200000.00"));
    await flush();

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.userId).toBe(user.id);
    expect(push.sent[0]!.message.title).toBe("Top up berhasil");
    expect(JSON.stringify(push.sent[0]!.message)).not.toContain("200000");
  });

  it("top up gagal/expired tidak mengirim notifikasi", async () => {
    const user = await createUser("PUSHTOP2", "USER", "0.00");
    const order = await prisma.walletTopUpOrder.create({
      data: { userId: user.id, reference: `WTU-PUSH-${++sequence}`, amount: new Prisma.Decimal(100000) }
    });
    const push = new RecordingPush();
    const service = new WalletTopUpPaymentService(prisma, undefined, undefined, push);
    await service.handleMidtransNotification(settlement(order.reference, "100000.00", "expire"));
    await flush();
    expect(push.sent).toHaveLength(0);
  });

  // ---- Membership -------------------------------------------------------
  it("membership WEB: bayar -> 'sedang diverifikasi'; verifikasi -> 'aktif'; tanpa menggandakan", async () => {
    const push = new RecordingPush();
    const service = new MembershipOrderService(prisma, push);
    const order = await createWebOrder(service, "WEB", true);

    await service.markPaymentSuccess({ userId: order.buyerId, role: "USER", orderId: order.id, paymentReference: "p1" });
    await expect(
      service.markPaymentSuccess({ userId: order.buyerId, role: "USER", orderId: order.id, paymentReference: "p1" })
    ).rejects.toBeDefined();
    const admin = await createUser("PUSHADM1", "ADMIN", "0.00");
    await service.activateVerifiedOrder({ orderId: order.id, adminId: admin.id });
    await expect(service.activateVerifiedOrder({ orderId: order.id, adminId: admin.id })).rejects.toBeDefined();
    await flush();

    expect(push.sent.map((entry) => entry.message.title)).toEqual(["Pembayaran diterima", "Membership aktif"]);
    expect(push.sent.every((entry) => entry.userId === order.buyerId)).toBe(true);
  });

  it("membership WEB: dokumen ditolak -> notifikasi penolakan sekali", async () => {
    const push = new RecordingPush();
    const service = new MembershipOrderService(prisma, push);
    const order = await createWebOrder(service, "WEB", true);
    await service.markPaymentSuccess({ userId: order.buyerId, role: "USER", orderId: order.id, paymentReference: "p2" });
    const admin = await createUser("PUSHADM2", "ADMIN", "0.00");
    await service.rejectOrderDocuments({ orderId: order.id, adminId: admin.id, reason: "buram" });
    await expect(service.rejectOrderDocuments({ orderId: order.id, adminId: admin.id })).rejects.toBeDefined();
    await flush();
    expect(push.sent.map((entry) => entry.message.title)).toEqual(["Pembayaran diterima", "Dokumen membership ditolak"]);
    expect(JSON.stringify(push.sent[1]!.message)).not.toContain("buram");
  });

  it("membership kanal APP: bayar langsung 'aktif'", async () => {
    const push = new RecordingPush();
    const service = new MembershipOrderService(prisma, push);
    const order = await createWebOrder(service, "APP", false);
    await service.markPaymentSuccess({ userId: order.buyerId, role: "USER", orderId: order.id, paymentReference: "p3" });
    await flush();
    expect(push.sent.map((entry) => entry.message.title)).toEqual(["Membership aktif"]);
  });

  it("push gagal tidak mengubah hasil pembayaran membership", async () => {
    const push = new RecordingPush();
    push.failWith = new Error("fcm down");
    const service = new MembershipOrderService(prisma, push);
    const order = await createWebOrder(service, "WEB", true);
    const paid = await service.markPaymentSuccess({ userId: order.buyerId, role: "USER", orderId: order.id, paymentReference: "p4" });
    await flush();
    expect(paid.status).toBe("PAID");
  });
});

function sign(orderId: string, statusCode: string, grossAmount: string) {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${MIDTRANS_KEY}`).digest("hex");
}

function settlement(orderId: string, grossAmount: string, status = "settlement") {
  return {
    order_id: orderId,
    transaction_id: `txn-${orderId}`,
    transaction_status: status,
    status_code: "200",
    gross_amount: grossAmount,
    currency: "IDR",
    signature_key: sign(orderId, "200", grossAmount)
  };
}

async function createUser(label: string, role: UserRole, walletBalance: string): Promise<User> {
  sequence += 1;
  const referralCode = `${label}${sequence}`.slice(0, 24);
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  const user = await prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${String(sequence).padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(walletBalance),
      cashBalance: new Prisma.Decimal(walletBalance),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }
  });
  return user;
}

async function createWebOrder(
  service: InstanceType<typeof MembershipOrderService>,
  channel: "WEB" | "APP",
  withDocuments: boolean
) {
  const sponsor = await createUser("PUSHSPON", "USER", "0.00");
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  await prisma.userMembership.create({
    data: { userId: sponsor.id, membershipId: silver.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: sponsor.id }, data: { membershipId: silver.id } });
  const buyer = await createUser("PUSHBUY", "USER", "0.00");
  await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: buyer.id } });
  const order = await service.createOrder({ userId: buyer.id, packageId: silver.id, channel });
  if (withDocuments) {
    for (const type of ["KTP", "SELFIE"] as const) {
      await prisma.membershipDocument.create({
        data: { orderId: order.id, userId: buyer.id, type, localPath: `/dev/null/${type}` }
      });
    }
  }
  return { id: order.id, buyerId: buyer.id };
}
