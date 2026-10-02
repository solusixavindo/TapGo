import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  PaymentRefundGateway,
  RefundRequest,
  RefundResult
} from "../../src/modules/payments/application/PaymentRefundGateway.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Pengembalian dana untuk pembayaran TRANSFER MANUAL.
 *
 * Uang transfer manual tidak pernah lewat penyedia pembayaran, jadi:
 *  - refund lewat gateway TIDAK boleh dicoba (invoice tidak dikenal di sana);
 *  - dana dikembalikan lewat transfer bank oleh manusia, lalu Super Admin
 *    mencatatnya dengan nomor referensi bank;
 *  - pembukuan akhir sama dengan refund gateway (payment/invoice REFUNDED,
 *    audit) dan tidak bisa terjadi dua kali.
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

class FakeGateway implements PaymentRefundGateway {
  readonly provider = "FAKE";
  readonly requests: RefundRequest[] = [];
  async refund(request: RefundRequest): Promise<RefundResult> {
    this.requests.push(request);
    return { provider: this.provider, providerReference: "FAKE-REF", raw: {} };
  }
}

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let orders: MembershipOrderService;
let RefundModule: typeof import("../../src/modules/memberships/application/MembershipRefundService.js");
let ManualModule: typeof import("../../src/modules/memberships/application/ManualMembershipTransferService.js");
let seq = 0;

const savedEnv: Record<string, unknown> = {};
const ENV_KEYS = [
  "MANUAL_MEMBERSHIP_TRANSFER_ENABLED",
  "EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED",
  "MEMBERSHIP_PURCHASE_WEB_ENABLED",
  "MANUAL_TOPUP_BANK_NAME",
  "MANUAL_TOPUP_ACCOUNT_NUMBER",
  "MANUAL_TOPUP_ACCOUNT_HOLDER"
] as const;

describe.skipIf(!runIntegration)("Refund transfer manual membership", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "manual-refund-access-secret-0000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "manual-refund-refresh-secret-000000";

    const [{ createApp }, tokenService, envModule, refund, manual] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
      import("../../src/modules/memberships/application/MembershipRefundService.js"),
      import("../../src/modules/memberships/application/ManualMembershipTransferService.js")
    ]);
    signAccessToken = tokenService.signAccessToken as SignAccessToken;
    backendEnv = envModule.env;
    RefundModule = refund;
    ManualModule = manual;
    for (const key of ENV_KEYS) savedEnv[key] = (backendEnv as Record<string, unknown>)[key];
    orders = new MembershipOrderService(prisma);

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    Object.assign(backendEnv, {
      MANUAL_MEMBERSHIP_TRANSFER_ENABLED: true,
      EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED: true,
      MEMBERSHIP_PURCHASE_WEB_ENABLED: true,
      MANUAL_TOPUP_BANK_NAME: "BANK UJI",
      MANUAL_TOPUP_ACCOUNT_NUMBER: "0000000000",
      MANUAL_TOPUP_ACCOUNT_HOLDER: "PT UJI CONTOH"
    });
  });

  afterAll(async () => {
    Object.assign(backendEnv, savedEnv);
    await cleanDatabase();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("refund lewat gateway ditolak untuk pembayaran manual dan gateway TIDAK dipanggil", async () => {
    const scenario = await rejectedManualOrder();
    const gateway = new FakeGateway();
    const service = new RefundModule.MembershipRefundService(prisma, gateway);

    await expect(service.executeRefund({ orderId: scenario.orderId, adminId: scenario.finance.id })).rejects.toMatchObject({
      code: "MEMBERSHIP_REFUND_MANUAL_REQUIRED",
      statusCode: 409
    });
    expect(gateway.requests).toHaveLength(0);

    const payment = await prisma.membershipPayment.findFirstOrThrow({ where: { orderId: scenario.orderId } });
    expect(payment.status).toBe("PAID");
  });

  it("konfirmasi refund manual: payment dan invoice REFUNDED, jejak bank dan audit tercatat", async () => {
    const scenario = await rejectedManualOrder();
    const gateway = new FakeGateway();
    const service = new RefundModule.MembershipRefundService(prisma, gateway);

    const result = await service.confirmManualRefund({
      orderId: scenario.orderId,
      adminId: scenario.finance.id,
      bankReference: "TRF-BALIK-20261002-001"
    });
    expect(result).toMatchObject({ status: "REFUNDED", provider: "MANUAL_BANK", amount: scenario.price.toFixed(2) });
    expect(gateway.requests).toHaveLength(0);

    const order = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: scenario.orderId },
      include: { invoice: true, payments: true }
    });
    expect(order.payments[0]!.status).toBe("REFUNDED");
    expect(order.invoice?.status).toBe("REFUNDED");
    const refund = (order.registrationData as any).documentRejection.refund;
    expect(refund).toMatchObject({
      status: "REFUNDED",
      provider: "MANUAL_BANK",
      bankReference: "TRF-BALIK-20261002-001",
      executedBy: scenario.finance.id
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_REFUND_COMPLETED", entityId: scenario.orderId }
    });
    expect(audit.actorId).toBe(scenario.finance.id);
    expect(audit.metadata).toMatchObject({ provider: "MANUAL_BANK", bankReference: "TRF-BALIK-20261002-001" });
  });

  it("tidak bisa dua kali: konfirmasi ulang 409 dan hanya satu audit", async () => {
    const scenario = await rejectedManualOrder();
    const service = new RefundModule.MembershipRefundService(prisma, new FakeGateway());
    const input = { orderId: scenario.orderId, adminId: scenario.finance.id, bankReference: "TRF-001" };

    await service.confirmManualRefund(input);
    await expect(service.confirmManualRefund(input)).rejects.toMatchObject({
      code: "MEMBERSHIP_REFUND_ALREADY_COMPLETED"
    });
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_REFUND_COMPLETED" } })).toBe(1);
  });

  it("dua konfirmasi serentak: tepat satu yang menang", async () => {
    const scenario = await rejectedManualOrder();
    const service = new RefundModule.MembershipRefundService(prisma, new FakeGateway());
    const input = { orderId: scenario.orderId, adminId: scenario.finance.id, bankReference: "TRF-PARALEL" };

    const results = await Promise.allSettled([service.confirmManualRefund(input), service.confirmManualRefund(input)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_REFUND_COMPLETED" } })).toBe(1);
    expect(await prisma.membershipPayment.count({ where: { orderId: scenario.orderId, status: "REFUNDED" } })).toBe(1);
  });

  it("nomor referensi bank wajib diisi", async () => {
    const scenario = await rejectedManualOrder();
    const service = new RefundModule.MembershipRefundService(prisma, new FakeGateway());

    await expect(
      service.confirmManualRefund({ orderId: scenario.orderId, adminId: scenario.finance.id, bankReference: "   " })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REFUND_BANK_REFERENCE_REQUIRED" });
    const payment = await prisma.membershipPayment.findFirstOrThrow({ where: { orderId: scenario.orderId } });
    expect(payment.status).toBe("PAID");
  });

  it("konfirmasi manual ditolak untuk pembayaran non-manual (gateway) dan pesanan yang tidak ditolak", async () => {
    // Pembayaran gateway (bukan MANUAL_BANK).
    const buyer = await createUser("GWBUYER", "USER");
    const finance = await createUser("GWFIN", "SUPER_ADMIN");
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const gatewayOrder = await orders.createOrder({ userId: buyer.id, packageId: silver.id, channel: "WEB" });
    await orders.markPaymentSuccess({
      userId: buyer.id,
      role: "USER",
      orderId: gatewayOrder.id,
      paymentReference: `gw-${gatewayOrder.id}`
    });
    await orders.rejectOrderDocuments({ orderId: gatewayOrder.id, adminId: finance.id, reason: "uji" });
    const service = new RefundModule.MembershipRefundService(prisma, new FakeGateway());
    await expect(
      service.confirmManualRefund({ orderId: gatewayOrder.id, adminId: finance.id, bankReference: "TRF-X" })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REFUND_MANUAL_NOT_APPLICABLE" });

    // Pesanan manual yang belum ditolak dokumennya.
    const open = await manualPaidOrder();
    await expect(
      service.confirmManualRefund({ orderId: open.orderId, adminId: open.finance.id, bankReference: "TRF-Y" })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REFUND_ORDER_NOT_REJECTED" });
  });

  it("rute admin: hanya SUPER_ADMIN; ADMIN 403, tanpa referensi 400, lalu 200", async () => {
    const scenario = await rejectedManualOrder();
    const admin = await createUser("PLAINADM", "ADMIN");
    const path = `/api/v1/admin/member-requests/${scenario.orderId}/confirm-manual-refund`;
    const call = (user: User | null, body: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {})
        },
        body: JSON.stringify(body)
      });

    expect((await call(null, { bankReference: "TRF-1" })).status).toBe(401);
    expect((await call(admin, { bankReference: "TRF-1" })).status).toBe(403);
    expect((await call(scenario.finance, {})).status).toBe(400);

    const ok = await call(scenario.finance, { bankReference: "TRF-1" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: { status: string } }).data.status).toBe("REFUNDED");
    expect((await call(scenario.finance, { bankReference: "TRF-1" })).status).toBe(409);
  });

  it("rute lama execute-refund untuk pesanan manual mengembalikan 409 yang jelas", async () => {
    const scenario = await rejectedManualOrder();
    const res = await fetch(`${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/execute-refund`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokenFor(scenario.finance)}` },
      body: "{}"
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("MEMBERSHIP_REFUND_MANUAL_REQUIRED");
  });
});

// ---- bantuan ---------------------------------------------------------------

type Scenario = { orderId: string; finance: User; buyer: User; price: number };

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

/** Pesanan WEB dibayar lewat transfer manual dan sudah dikonfirmasi (lunas, belum aktif). */
async function manualPaidOrder(): Promise<Scenario> {
  const buyer = await createUser("MBUYER", "USER");
  const finance = await createUser("MFIN", "SUPER_ADMIN");
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await orders.createOrder({ userId: buyer.id, packageId: silver.id, channel: "WEB" });
  const manual = new ManualModule.ManualMembershipTransferService(prisma, orders);
  await manual.start({ userId: buyer.id, orderId: order.id });
  await manual.confirm({ orderId: order.id, actorId: finance.id, actorRole: "SUPER_ADMIN" });
  return { orderId: order.id, finance, buyer, price: silver.price.toNumber() };
}

/** Sama, lalu dokumen ditolak: refund tertunda (PENDING). */
async function rejectedManualOrder(): Promise<Scenario> {
  const scenario = await manualPaidOrder();
  await orders.rejectOrderDocuments({ orderId: scenario.orderId, adminId: scenario.finance.id, reason: "KTP tidak terbaca" });
  return scenario;
}

async function createUser(label: string, role: UserRole): Promise<User> {
  seq += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${label}${seq}`,
      phone: `+6286${String(seq).padStart(8, "0")}`,
      referralCode: `${label}${seq}`.slice(0, 24),
      role,
      status: "ACTIVE",
      membershipId: basic.id
    }
  });
}
