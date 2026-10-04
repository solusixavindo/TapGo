import { MembershipOrderChannel, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  openManualTransferAmounts,
  pickFreeUniqueCode
} from "../../src/modules/payments/application/manualTransferAmounts.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Pembayaran membership lewat transfer bank manual (kanal WEB).
 *
 * Yang dijaga di sini adalah jalur UANG: siapa yang boleh mengonfirmasi, apa
 * yang TIDAK boleh ikut terjadi saat uang dikonfirmasi (aktivasi dan bonus
 * baru berjalan setelah verifikasi dokumen), dan keadaan yang harus ditolak
 * (konfirmasi ganda, kanal salah, pembayaran online yang sudah berjalan,
 * nominal unik yang ambigu).
 */

type Channel = "WEB" | "APP" | "ADMIN";
type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
  channel?: Channel;
}) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let orderService: MembershipOrderService;
let seq = 0;

const savedEnv: Record<string, unknown> = {};
const ENV_KEYS = [
  "MANUAL_MEMBERSHIP_TRANSFER_ENABLED",
  "EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED",
  "MEMBERSHIP_PURCHASE_WEB_ENABLED",
  "MANUAL_TOPUP_BANK_NAME",
  "MANUAL_TOPUP_ACCOUNT_NUMBER",
  "MANUAL_TOPUP_ACCOUNT_HOLDER",
  "MANUAL_TOPUP_ENABLED",
  "MEMBERSHIP_ONLINE_PAYMENT_ENABLED",
  "DOKU_ENABLED",
  "MIDTRANS_SERVER_KEY"
] as const;

describe.skipIf(!runIntegration)("Transfer bank manual untuk membership", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "manual-membership-access-secret-0";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "manual-membership-refresh-secret-";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken as SignAccessToken;
    backendEnv = envModule.env;
    for (const key of ENV_KEYS) savedEnv[key] = (backendEnv as Record<string, unknown>)[key];
    orderService = new MembershipOrderService(prisma);

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    enableEverything();
  });

  afterAll(async () => {
    Object.assign(backendEnv, savedEnv);
    await cleanDatabase();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  function enableEverything() {
    Object.assign(backendEnv, {
      MANUAL_MEMBERSHIP_TRANSFER_ENABLED: true,
      EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED: true,
      MEMBERSHIP_PURCHASE_WEB_ENABLED: true,
      MANUAL_TOPUP_ENABLED: true,
      // Kondisi nyata selama Midtrans belum siap: kunci gateway ADA (dipakai
      // fitur lain) tetapi jalur online untuk membership sengaja mati.
      MEMBERSHIP_ONLINE_PAYMENT_ENABLED: false,
      DOKU_ENABLED: false,
      MIDTRANS_SERVER_KEY: "SB-Mid-server-uji",
      MANUAL_TOPUP_BANK_NAME: "BANK UJI",
      MANUAL_TOPUP_ACCOUNT_NUMBER: "0000000000",
      MANUAL_TOPUP_ACCOUNT_HOLDER: "PT UJI CONTOH"
    });
  }

  // ---- gerbang ------------------------------------------------------------

  it("flag mati: opsi tidak ditawarkan dan memulai transfer ditolak 403", async () => {
    backendEnv.MANUAL_MEMBERSHIP_TRANSFER_ENABLED = false;
    const { order, buyer } = await createWebOrder();

    const options = await getJson("/api/v1/web/membership/payment-options", buyer);
    expect(options.data.manualTransfer).toBe(false);

    const res = await startTransfer(order.id, buyer);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("MEMBERSHIP_MANUAL_TRANSFER_DISABLED");
  });

  it("gerbang kanal pembelian web tertutup: transfer manual ikut tertutup", async () => {
    const { order, buyer } = await createWebOrder();
    backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = false;

    expect((await startTransfer(order.id, buyer)).status).toBe(403);
    const options = await getJson("/api/v1/web/membership/payment-options", buyer);
    expect(options.data.manualTransfer).toBe(false);
  });

  it("rekening belum diisi: 503 dan opsi tidak ditawarkan", async () => {
    const { order, buyer } = await createWebOrder();
    backendEnv.MANUAL_TOPUP_ACCOUNT_NUMBER = undefined;

    const options = await getJson("/api/v1/web/membership/payment-options", buyer);
    expect(options.data.manualTransfer).toBe(false);
    const res = await startTransfer(order.id, buyer);
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe("MEMBERSHIP_MANUAL_TRANSFER_NOT_CONFIGURED");
  });

  it("token kanal APP (aplikasi Play) ditolak 403", async () => {
    const { order, buyer } = await createWebOrder();
    const res = await startTransfer(order.id, buyer, "APP");
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("AUTH_CHANNEL_FORBIDDEN");
  });

  it("kunci gateway terisi tetapi flag online mati: online=false dan pay ditolak 403", async () => {
    const { order, buyer } = await createWebOrder();
    const options = await getJson("/api/v1/web/membership/payment-options", buyer);
    expect(options.data).toEqual({ online: false, manualTransfer: true });

    const before = await prisma.membershipPayment.findMany({ where: { orderId: order.id } });
    const res = await fetch(`${baseUrl}/api/v1/web/membership/orders/${order.id}/pay`, {
      method: "POST",
      headers: jsonHeaders(buyer, "WEB"),
      body: "{}"
    });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("MEMBERSHIP_ONLINE_PAYMENT_DISABLED");
    // Gateway tidak tersentuh: baris pembayaran tidak berubah sama sekali.
    const after = await prisma.membershipPayment.findMany({ where: { orderId: order.id } });
    expect(after.map((row) => [row.id, row.provider, row.providerReference, row.status])).toEqual(
      before.map((row) => [row.id, row.provider, row.providerReference, row.status])
    );
  });

  it("flag online hidup: online=true hanya bila gateway juga terkonfigurasi", async () => {
    const { buyer } = await createWebOrder();
    backendEnv.MEMBERSHIP_ONLINE_PAYMENT_ENABLED = true;

    expect((await getJson("/api/v1/web/membership/payment-options", buyer)).data.online).toBe(true);

    backendEnv.MIDTRANS_SERVER_KEY = undefined;
    expect((await getJson("/api/v1/web/membership/payment-options", buyer)).data.online).toBe(false);
  });

  it("flag online hidup tetapi gerbang kanal pembelian tertutup: online=false", async () => {
    const { buyer } = await createWebOrder();
    backendEnv.MEMBERSHIP_ONLINE_PAYMENT_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = false;
    expect((await getJson("/api/v1/web/membership/payment-options", buyer)).data.online).toBe(false);
  });

  it("opsi tampil bila semua gerbang terbuka dan rekening terisi", async () => {
    const { buyer } = await createWebOrder();
    const options = await getJson("/api/v1/web/membership/payment-options", buyer);
    expect(options.data.manualTransfer).toBe(true);
  });

  // ---- memulai transfer ---------------------------------------------------

  it("memulai transfer: nominal = harga + kode unik, rekening tampil, harga di database tidak berubah", async () => {
    const { order, buyer, price } = await createWebOrder();
    const res = await startTransfer(order.id, buyer);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: TransferView };

    expect(data.baseAmount).toBe(price);
    expect(data.uniqueCode).toBeGreaterThanOrEqual(1);
    expect(data.uniqueCode).toBeLessThanOrEqual(999);
    expect(data.transferAmount).toBe(price + data.uniqueCode);
    expect(data.bank).toEqual({ bankName: "BANK UJI", accountNumber: "0000000000", accountHolder: "PT UJI CONTOH" });
    expect(data.status).toBe("PENDING");
    expect(data.expired).toBe(false);
    const hoursLeft = (new Date(data.expiresAt).getTime() - Date.now()) / 3600_000;
    expect(hoursLeft).toBeGreaterThan(23);
    expect(hoursLeft).toBeLessThanOrEqual(24.01);

    // Uang BELUM dicatat, harga tidak berubah oleh kode unik.
    const stored = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { invoice: true, payments: true }
    });
    expect(stored.status).toBe("PENDING");
    expect(stored.invoice?.status).toBe("PENDING");
    expect(stored.invoice?.amount.toNumber()).toBe(price);
    expect(stored.payments).toHaveLength(1);
    expect(stored.payments[0]!.status).toBe("PENDING");
    expect(stored.payments[0]!.amount.toNumber()).toBe(price);
    expect(stored.payments[0]!.provider).toBe("MANUAL_BANK");
    expect(stored.payments[0]!.method).toBe("BANK_TRANSFER");
    expect(await prisma.userMembership.count({ where: { userId: buyer.id } })).toBe(0);
  });

  it("idempoten: memanggil lagi selama berlaku mengembalikan nominal yang SAMA", async () => {
    const { order, buyer } = await createWebOrder();
    const first = ((await (await startTransfer(order.id, buyer)).json()) as { data: TransferView }).data;
    const second = ((await (await startTransfer(order.id, buyer)).json()) as { data: TransferView }).data;
    expect(second.transferAmount).toBe(first.transferAmount);
    expect(second.expiresAt).toBe(first.expiresAt);
    expect(await prisma.membershipPayment.count()).toBe(1);
  });

  it("setelah kedaluwarsa, memulai lagi menerbitkan kode baru dan masa berlaku baru", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    await expirePayment(order.id);

    const res = await startTransfer(order.id, buyer);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: TransferView };
    expect(data.expired).toBe(false);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.membershipPayment.count()).toBe(1);
  });

  it("petunjuk transfer hanya bisa dibaca pemilik pengajuan", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    const stranger = await createUser("STRANGER", "USER");

    const own = await getJson(`/api/v1/web/membership/orders/${order.id}/manual-transfer`, buyer);
    expect(own.success).toBe(true);

    const other = await fetchAs(`/api/v1/web/membership/orders/${order.id}/manual-transfer`, stranger);
    expect(other.status).toBe(404);
    const otherStart = await startTransfer(order.id, stranger);
    expect(otherStart.status).toBe(404);
  });

  it("order tanpa transfer manual: petunjuk 404", async () => {
    const { order, buyer } = await createWebOrder();
    const res = await fetchAs(`/api/v1/web/membership/orders/${order.id}/manual-transfer`, buyer);
    expect(res.status).toBe(404);
  });

  it("menolak memulai transfer bila pembayaran online (gateway) sudah dimulai", async () => {
    const { order, buyer } = await createWebOrder();
    await prisma.membershipPayment.updateMany({
      where: { orderId: order.id },
      data: { provider: "MIDTRANS", method: "MIDTRANS_SNAP", providerReference: "SNAP-123" }
    });
    const res = await startTransfer(order.id, buyer);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("MEMBERSHIP_PAYMENT_ALREADY_STARTED");
  });

  it("menolak memulai transfer untuk pengajuan yang sudah lunas atau dibatalkan", async () => {
    const paid = await createWebOrder();
    await orderService.markPaymentSuccess({ userId: paid.buyer.id, role: "USER", orderId: paid.order.id });
    const paidRes = await startTransfer(paid.order.id, paid.buyer);
    expect(paidRes.status).toBe(409);
    expect(await codeOf(paidRes)).toBe("MEMBERSHIP_ORDER_NOT_PENDING");

    const cancelled = await createWebOrder();
    await prisma.membershipOrder.update({ where: { id: cancelled.order.id }, data: { status: "CANCELLED" } });
    expect((await startTransfer(cancelled.order.id, cancelled.buyer)).status).toBe(409);
  });

  it("menolak transfer manual untuk order yang bukan kanal WEB", async () => {
    const { order, buyer } = await createWebOrder({ channel: "APP" });
    const res = await startTransfer(order.id, buyer);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("MEMBERSHIP_MANUAL_TRANSFER_CHANNEL");
  });

  it("dua pengajuan terbuka tidak pernah mendapat nominal transfer yang sama", async () => {
    const amounts = new Set<number>();
    for (let index = 0; index < 8; index += 1) {
      const { order, buyer } = await createWebOrder({ label: `UNIK${index}` });
      const { data } = (await (await startTransfer(order.id, buyer)).json()) as { data: TransferView };
      amounts.add(data.transferAmount);
    }
    expect(amounts.size).toBe(8);
  });

  // ---- nominal unik lintas top up dan membership --------------------------

  it("nominal terbuka dihitung dari top up manual DAN membership manual", async () => {
    const { order, buyer } = await createWebOrder();
    const { data } = (await (await startTransfer(order.id, buyer)).json()) as { data: TransferView };
    await prisma.walletTopUpOrder.create({
      data: {
        userId: buyer.id,
        reference: "MTOP-UJI-1",
        amount: 123_456,
        status: "PENDING",
        method: "BANK_TRANSFER",
        provider: "MANUAL_BANK",
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });
    await prisma.walletTopUpOrder.create({
      data: {
        userId: buyer.id,
        reference: "MTOP-UJI-KEDALUWARSA",
        amount: 777_777,
        status: "PENDING",
        method: "BANK_TRANSFER",
        provider: "MANUAL_BANK",
        expiresAt: new Date(Date.now() - 3600_000)
      }
    });

    const open = await openManualTransferAmounts(prisma, new Date());
    expect(open.has(data.transferAmount)).toBe(true);
    expect(open.has(123_456)).toBe(true);
    expect(open.has(777_777)).toBe(false);
  });

  it("pickFreeUniqueCode menghindari nominal yang dipakai dan null bila 999 kode habis", () => {
    const taken = new Set<number>();
    for (let code = 1; code <= 999; code += 1) taken.add(1_000_000 + code);
    expect(pickFreeUniqueCode(1_000_000, taken)).toBeNull();

    taken.delete(1_000_500);
    expect(pickFreeUniqueCode(1_000_000, taken)).toBe(500);
  });

  // ---- konfirmasi Super Admin ---------------------------------------------

  it("hanya SUPER_ADMIN yang boleh mengonfirmasi: tanpa token 401, USER dan ADMIN 403", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    const admin = await createUser("ADM", "ADMIN");

    expect((await confirmTransfer(order.id)).status).toBe(401);
    expect((await confirmTransfer(order.id, buyer)).status).toBe(403);
    expect((await confirmTransfer(order.id, admin)).status).toBe(403);

    const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("PENDING");
  });

  it("SUPER_ADMIN mengonfirmasi: lunas, TETAPI belum aktif dan belum ada bonus (menunggu verifikasi dokumen)", async () => {
    const { order, buyer, sponsor, price } = await createWebOrder();
    const { data } = (await (await startTransfer(order.id, buyer)).json()) as { data: TransferView };
    const finance = await createUser("FIN", "SUPER_ADMIN");

    const res = await confirmTransfer(order.id, finance);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; alreadyConfirmed: boolean } };
    expect(body.data).toMatchObject({ status: "PAID", alreadyConfirmed: false });

    const stored = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { invoice: true, payments: true }
    });
    expect(stored.status).toBe("PAID");
    expect(stored.invoice?.status).toBe("PAID");
    expect(stored.payments[0]!.status).toBe("PAID");
    expect(stored.payments[0]!.providerReference).toBe(`MANUAL:${finance.id}`);
    // Pendapatan dicatat sebesar HARGA, bukan nominal berkode unik.
    expect(stored.payments[0]!.amount.toNumber()).toBe(price);

    // Aktivasi dan bonus menunggu verifikasi dokumen.
    expect(await prisma.userMembership.findUnique({ where: { orderId: order.id } })).toBeNull();
    expect(await prisma.commission.count({ where: { triggerType: "MEMBERSHIP_ORDER", triggerId: order.id } })).toBe(0);
    expect(await prisma.wallet.count({ where: { userId: sponsor.id } })).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED", entityId: order.id }
    });
    expect(audit.actorId).toBe(finance.id);
    expect(audit.metadata).toMatchObject({
      targetUserId: buyer.id,
      transferAmount: data.transferAmount,
      baseAmount: price,
      uniqueCode: data.uniqueCode,
      confirmedAfterExpiry: false
    });
  });

  it("konfirmasi dua kali idempoten: tidak ada efek, audit, atau pembayaran ganda", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    const finance = await createUser("FIN", "SUPER_ADMIN");

    expect((await confirmTransfer(order.id, finance)).status).toBe(200);
    const again = await confirmTransfer(order.id, finance);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: { alreadyConfirmed: boolean } }).data.alreadyConfirmed).toBe(true);

    expect(await prisma.membershipPayment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED" } })).toBe(1);
  });

  it("dua konfirmasi serentak: tepat satu yang menang, tidak ada pembukuan ganda", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    const finance = await createUser("FIN", "SUPER_ADMIN");

    const [a, b] = await Promise.all([confirmTransfer(order.id, finance), confirmTransfer(order.id, finance)]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const flags = [
      ((await a.json()) as { data: { alreadyConfirmed: boolean } }).data.alreadyConfirmed,
      ((await b.json()) as { data: { alreadyConfirmed: boolean } }).data.alreadyConfirmed
    ];
    expect(flags.filter((value) => value === false)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED" } })).toBe(1);
    expect(await prisma.membershipPayment.count({ where: { orderId: order.id, status: "PAID" } })).toBe(1);
  });

  it("menolak konfirmasi untuk pengajuan yang tidak memakai transfer manual", async () => {
    const { order } = await createWebOrder();
    const finance = await createUser("FIN", "SUPER_ADMIN");
    const res = await confirmTransfer(order.id, finance);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("MEMBERSHIP_MANUAL_TRANSFER_NOT_FOUND");
    expect((await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("menolak konfirmasi untuk pengajuan yang sudah dibatalkan; 404 untuk id yang tidak ada", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    const finance = await createUser("FIN", "SUPER_ADMIN");

    const cancel = await fetch(`${baseUrl}/api/v1/admin/member-requests/${order.id}/reject`, {
      method: "POST",
      headers: jsonHeaders(finance),
      body: JSON.stringify({ reason: "Tidak jadi" })
    });
    expect(cancel.status).toBe(200);

    const res = await confirmTransfer(order.id, finance);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("MEMBERSHIP_MANUAL_TRANSFER_NOT_PENDING");

    expect((await confirmTransfer("00000000-0000-4000-8000-000000000000", finance)).status).toBe(404);
  });

  it("konfirmasi setelah kedaluwarsa tetap sah bila nominalnya tidak bentrok; tercatat di audit", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    await expirePayment(order.id);
    const finance = await createUser("FIN", "SUPER_ADMIN");

    const res = await confirmTransfer(order.id, finance);
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED", entityId: order.id }
    });
    expect(audit.metadata).toMatchObject({ confirmedAfterExpiry: true });
  });

  it("konfirmasi setelah kedaluwarsa DITOLAK bila nominalnya sedang dipakai pesanan terbuka lain", async () => {
    const { order, buyer } = await createWebOrder();
    const { data } = (await (await startTransfer(order.id, buyer)).json()) as { data: TransferView };
    await expirePayment(order.id);
    // Pesanan top up manual lain yang masih berlaku memakai nominal yang sama.
    const other = await createUser("OTHER", "USER");
    await prisma.walletTopUpOrder.create({
      data: {
        userId: other.id,
        reference: "MTOP-BENTROK",
        amount: data.transferAmount,
        status: "PENDING",
        method: "BANK_TRANSFER",
        provider: "MANUAL_BANK",
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });
    const finance = await createUser("FIN", "SUPER_ADMIN");

    const res = await confirmTransfer(order.id, finance);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("MEMBERSHIP_MANUAL_TRANSFER_AMBIGUOUS");
    expect((await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");
  });

  it("konfirmasi tetap bisa walau flag transfer manual sudah dimatikan (uang sudah terlanjur masuk)", async () => {
    const { order, buyer } = await createWebOrder();
    await startTransfer(order.id, buyer);
    backendEnv.MANUAL_MEMBERSHIP_TRANSFER_ENABLED = false;
    const finance = await createUser("FIN", "SUPER_ADMIN");
    expect((await confirmTransfer(order.id, finance)).status).toBe(200);
  });

  // ---- alur penuh ----------------------------------------------------------

  it("alur penuh: bayar manual -> konfirmasi Super Admin -> verifikasi dokumen -> membership aktif + bonus sponsor", async () => {
    const { order, buyer, sponsor } = await createWebOrder({ withDocuments: true });
    await startTransfer(order.id, buyer);
    const finance = await createUser("FIN", "SUPER_ADMIN");
    const admin = await createUser("ADM", "ADMIN");

    expect((await confirmTransfer(order.id, finance)).status).toBe(200);
    expect(await prisma.userMembership.findUnique({ where: { orderId: order.id } })).toBeNull();

    // Verifikasi dokumen oleh admin biasa (bukan uang) mengaktifkan membership.
    const verify = await fetch(`${baseUrl}/api/v1/admin/member-requests/${order.id}/verify-documents`, {
      method: "POST",
      headers: jsonHeaders(admin),
      body: "{}"
    });
    expect(verify.status).toBe(200);

    const membership = await prisma.userMembership.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(membership.status).toBe("ACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).membershipId).toBe(membership.membershipId);
    const bonus = await prisma.commission.count({
      where: { triggerType: "MEMBERSHIP_ORDER", triggerId: order.id, beneficiaryId: sponsor.id }
    });
    expect(bonus).toBeGreaterThanOrEqual(1);
  });

  it("daftar pengajuan admin memuat nominal transfer berkode unik untuk pencocokan mutasi", async () => {
    const { order, buyer } = await createWebOrder();
    const { data } = (await (await startTransfer(order.id, buyer)).json()) as { data: TransferView };
    const finance = await createUser("FIN", "SUPER_ADMIN");

    const list = await getJson("/api/v1/admin/member-requests?status=PENDING", finance);
    const row = (list.data.items as Array<{ id: string; payments: Array<{ provider: string; metadata: { transferAmount: number } }> }>).find(
      (item) => item.id === order.id
    );
    expect(row?.payments[0]?.provider).toBe("MANUAL_BANK");
    expect(row?.payments[0]?.metadata.transferAmount).toBe(data.transferAmount);
  });
});

// ---- bantuan ---------------------------------------------------------------

type TransferView = {
  orderId: string;
  invoiceNumber: string;
  packageName: string;
  status: string;
  baseAmount: number;
  uniqueCode: number;
  transferAmount: number;
  expiresAt: string;
  expired: boolean;
  bank: { bankName: string; accountNumber: string; accountHolder: string };
};

async function createWebOrder(options: { channel?: MembershipOrderChannel; withDocuments?: boolean; label?: string } = {}) {
  const label = options.label ?? "BUYER";
  const sponsor = await createUser(`SP${label}`, "USER");
  await activateSilver(sponsor.id);
  const buyer = await createUser(label, "USER");
  await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: buyer.id } });

  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await orderService.createOrder({
    userId: buyer.id,
    packageId: silver.id,
    channel: options.channel ?? "WEB"
  });
  if (options.withDocuments) {
    for (const type of ["KTP", "SELFIE"] as const) {
      await prisma.membershipDocument.create({
        data: { orderId: order.id, userId: buyer.id, type, localPath: `/dev/null/${type}` }
      });
    }
  }
  return { order, buyer, sponsor, price: silver.price.toNumber() };
}

function tokenFor(user: User, channel?: Channel) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
    ...(channel ? { channel } : {})
  });
}

function jsonHeaders(user: User, channel?: Channel) {
  return { "content-type": "application/json", authorization: `Bearer ${tokenFor(user, channel)}` };
}

function startTransfer(orderId: string, user: User, channel: Channel = "WEB") {
  return fetch(`${baseUrl}/api/v1/web/membership/orders/${orderId}/manual-transfer`, {
    method: "POST",
    headers: jsonHeaders(user, channel),
    body: "{}"
  });
}

function confirmTransfer(orderId: string, user?: User) {
  return fetch(`${baseUrl}/api/v1/admin/member-requests/${orderId}/confirm-transfer`, {
    method: "POST",
    headers: user ? jsonHeaders(user) : { "content-type": "application/json" },
    body: "{}"
  });
}

function fetchAs(path: string, user: User, channel: Channel = "WEB") {
  return fetch(`${baseUrl}${path}`, { headers: jsonHeaders(user, channel) });
}

async function getJson(path: string, user: User, channel?: Channel) {
  const res = await fetch(`${baseUrl}${path}`, { headers: jsonHeaders(user, channel ?? (user.role === "USER" ? "WEB" : undefined)) });
  return (await res.json()) as { success: boolean; data: any };
}

async function codeOf(response: Response) {
  return ((await response.json()) as { code?: string }).code;
}

/** Memundurkan batas waktu transfer ke masa lalu tanpa menunggu 24 jam. */
async function expirePayment(orderId: string) {
  const payment = await prisma.membershipPayment.findFirstOrThrow({ where: { orderId } });
  await prisma.membershipPayment.update({
    where: { id: payment.id },
    data: { metadata: { ...(payment.metadata as object), expiresAt: new Date(Date.now() - 3600_000).toISOString() } }
  });
}

async function createUser(label: string, role: UserRole): Promise<User> {
  seq += 1;
  const referralCode = `${label}${seq}`.slice(0, 24);
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${String(seq).padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

async function activateSilver(userId: string) {
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  await prisma.userMembership.create({
    data: { userId, membershipId: silver.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: silver.id } });
}
