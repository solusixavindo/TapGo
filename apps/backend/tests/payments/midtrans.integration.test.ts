import { MembershipTier, User, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

const midtransServerKey = "SB-Mid-server-test-key";
let appServer: Server | undefined;
let snapServer: Server | undefined;
/** Muatan yang benar-benar dikirim ke Snap, untuk diperiksa uji. */
let snapRequests: Record<string, unknown>[] = [];
let baseUrl = "";
let signAccessToken: SignAccessToken;
const originalExternalMembershipPaymentsEnabled =
  env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
const originalExternalMembershipPaymentsEnabledEnv =
  process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
/**
 * Berkas ini menguji kanal APLIKASI, sedangkan .env pengembangan menutupnya
 * demi kepatuhan Google Play. Menyetel process.env saja tidak cukup: modul env
 * sudah selesai dibaca sebelum beforeAll berjalan, sehingga nilainya harus
 * ditimpa langsung pada objek env — lalu DIKEMBALIKAN di afterAll, karena
 * seluruh berkas uji berbagi satu proses dan satu registry modul.
 */
const originalAppPurchaseEnabled = env.MEMBERSHIP_PURCHASE_APP_ENABLED;

describe.skipIf(!runIntegration)("Midtrans sandbox membership payments", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    snapServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/snap/v1/transactions") {
        res.writeHead(404).end();
        return;
      }

      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const parsed = JSON.parse(body) as {
          transaction_details?: { order_id?: string };
        } & Record<string, unknown>;
        snapRequests.push(parsed);
        const orderId = parsed.transaction_details?.order_id ?? "UNKNOWN";
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({
          token: `snap-token-${orderId}`,
          redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/snap-token-${orderId}`
        }));
      });
    });
    await new Promise<void>((resolve) => snapServer!.listen(0, "127.0.0.1", resolve));
    const snapAddress = snapServer.address() as AddressInfo;

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-midtrans-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-midtrans-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    process.env.MIDTRANS_SERVER_KEY = midtransServerKey;
    process.env.MIDTRANS_CLIENT_KEY = "SB-Mid-client-test-key";
    process.env.MIDTRANS_IS_PRODUCTION = "false";
    process.env.MIDTRANS_SNAP_URL = `http://127.0.0.1:${snapAddress.port}/snap/v1/transactions`;
    process.env.DOKU_ENABLED = "false";
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "true";
    process.env.MEMBERSHIP_PURCHASE_APP_ENABLED = "true";
    Object.assign(env, {
      MIDTRANS_SERVER_KEY: midtransServerKey,
      MIDTRANS_CLIENT_KEY: "SB-Mid-client-test-key",
      MIDTRANS_IS_PRODUCTION: false,
      MIDTRANS_SNAP_URL: `http://127.0.0.1:${snapAddress.port}/snap/v1/transactions`,
      DOKU_ENABLED: false,
      EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED: true,
      MEMBERSHIP_PURCHASE_APP_ENABLED: true,
    });

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    const appAddress = appServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${appAddress.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    snapRequests = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) {
        resolve();
        return;
      }
      appServer.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      if (!snapServer) {
        resolve();
        return;
      }
      snapServer.close((error) => (error ? reject(error) : resolve()));
    });
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
      originalExternalMembershipPaymentsEnabled;
    env.MEMBERSHIP_PURCHASE_APP_ENABLED = originalAppPurchaseEnabled;
    if (originalExternalMembershipPaymentsEnabledEnv === undefined) {
      delete process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    } else {
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalMembershipPaymentsEnabledEnv;
    }
  });

  it("creates a Midtrans Snap transaction for a pending membership order", async () => {
    const user = await createApiUser("MID001");
    const order = await createOrderFor(user, "SILVER");

    const response = await api(`/api/v1/membership/orders/${order.id}/pay`, {
      method: "POST",
      token: tokenFor(user)
    });
    const body = await response.json() as {
      data: { snapToken: string; redirectUrl: string; orderId: string; invoiceNumber: string };
    };

    expect(response.status).toBe(200);
    expect(body.data.orderId).toBe(order.id);
    expect(body.data.snapToken).toContain(body.data.invoiceNumber);
    expect(body.data.redirectUrl).toContain("app.sandbox.midtrans.com");
  });

  /**
   * Metode bayar dibatasi ke yang benar-benar dapat dikembalikan lewat API.
   *
   * Ini bukan soal selera: alur R2.6 menjanjikan pengembalian dana PENUH bila
   * dokumen identitas ditolak. Diuji langsung ke sandbox Midtrans, refund atas
   * transaksi bank transfer (VA) DITOLAK dengan "Payment Provider doesn't allow
   * refund within this time". Menawarkan VA berarti menjanjikan sesuatu yang
   * tidak dapat kita tepati.
   */
  it("hanya menawarkan metode bayar yang dapat direfund", async () => {
    const user = await createApiUser("MIDPAY1");
    const order = await createOrderFor(user, "SILVER");

    await api(`/api/v1/membership/orders/${order.id}/pay`, {
      method: "POST",
      token: tokenFor(user)
    });

    expect(snapRequests).toHaveLength(1);
    const enabled = snapRequests[0]!.enabled_payments as string[] | undefined;

    // Wajib ada dan wajib merupakan daftar tertutup. Tanpa enabled_payments,
    // Midtrans menampilkan SELURUH metode termasuk VA.
    expect(Array.isArray(enabled)).toBe(true);
    expect(enabled).toEqual(["credit_card", "gopay", "other_qris"]);
  });

  it("tidak pernah menawarkan bank transfer maupun gerai ritel", async () => {
    const user = await createApiUser("MIDPAY2");
    const order = await createOrderFor(user, "GOLD");

    await api(`/api/v1/membership/orders/${order.id}/pay`, {
      method: "POST",
      token: tokenFor(user)
    });

    const enabled = snapRequests[0]!.enabled_payments as string[] | undefined;

    // Pemeriksaan ini WAJIB lebih dulu. Tanpanya, daftar yang tidak ada sama
    // sekali akan lolos begitu saja — padahal justru itu keadaan terburuknya:
    // Midtrans lalu menampilkan SELURUH metode, termasuk VA.
    expect(enabled, "enabled_payments wajib dikirim").toBeDefined();
    expect(enabled!.length).toBeGreaterThan(0);

    // Daftar terlarang ditulis eksplisit. Memeriksa "hanya tiga yang boleh"
    // saja tidak cukup: bila suatu saat daftar diperlebar tanpa berpikir,
    // pemeriksaan inilah yang menyalakan alarm.
    const dilarang = [
      "bank_transfer", "bca_va", "bni_va", "bri_va", "cimb_va", "permata_va",
      "other_va", "echannel", "indomaret", "alfamart", "akulaku", "kredivo"
    ];
    for (const metode of dilarang) {
      expect(enabled, `${metode} tidak boleh ditawarkan`).not.toContain(metode);
    }
  });

  it("blocks Midtrans payment creation for an already paid order", async () => {
    const user = await createApiUser("MID002");
    const order = await createOrderFor(user, "SILVER");
    await postSettlement(order.invoiceNumber, "500000.00");

    const response = await api(`/api/v1/membership/orders/${order.id}/pay`, {
      method: "POST",
      token: tokenFor(user)
    });

    expect(response.status).toBe(409);
  });

  it("settlement callback activates membership and credits PPOB once", async () => {
    const user = await createApiUser("MID003");
    const order = await createOrderFor(user, "SILVER");

    const response = await postSettlement(order.invoiceNumber, "500000.00");
    const duplicate = await postSettlement(order.invoiceNumber, "500000.00");

    expect(response.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletBalance(user.id, "100000.00");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
  });

  it("expired callback marks the order as expired without activating membership", async () => {
    const user = await createApiUser("MID004");
    const order = await createOrderFor(user, "GOLD");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "expire",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "200",
      gross_amount: "3000000.00"
    });

    expect(response.status).toBe(200);
    const updatedOrder = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { invoice: true, userMembership: true }
    });
    expect(updatedOrder.status).toBe("EXPIRED");
    expect(updatedOrder.invoice?.status).toBe("EXPIRED");
    expect(updatedOrder.userMembership).toBeNull();
  });

  it("rejects invalid Midtrans signatures", async () => {
    const user = await createApiUser("MID005");
    const order = await createOrderFor(user, "SILVER");

    const response = await api("/api/v1/payments/midtrans/notification", {
      method: "POST",
      body: {
        order_id: order.invoiceNumber,
        transaction_status: "settlement",
        transaction_id: `tx-${order.invoiceNumber}`,
        status_code: "200",
        gross_amount: "500000.00",
        signature_key: "invalid-signature"
      }
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  // P1-2: verifikasi gross_amount terhadap nominal order authoritative.
  it("accepts a settlement whose gross_amount matches the order amount", async () => {
    const user = await createApiUser("MIDAMT01");
    const order = await createOrderFor(user, "SILVER");

    const response = await postSettlement(order.invoiceNumber, "500000.00");

    expect(response.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
  });

  it("rejects a settlement with a lower gross_amount without activating", async () => {
    const user = await createApiUser("MIDAMT02");
    const order = await createOrderFor(user, "SILVER");

    const response = await postSettlement(order.invoiceNumber, "400000.00");

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("rejects a settlement with a higher gross_amount without activating", async () => {
    const user = await createApiUser("MIDAMT03");
    const order = await createOrderFor(user, "SILVER");

    const response = await postSettlement(order.invoiceNumber, "600000.00");

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("rejects a settlement with a malformed gross_amount", async () => {
    const user = await createApiUser("MIDAMT04");
    const order = await createOrderFor(user, "SILVER");

    const response = await postSettlement(order.invoiceNumber, "not-a-number");

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("processes duplicate valid callbacks idempotently", async () => {
    const user = await createApiUser("MIDAMT05");
    const order = await createOrderFor(user, "SILVER");

    const first = await postSettlement(order.invoiceNumber, "500000.00");
    const second = await postSettlement(order.invoiceNumber, "500000.00");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
  });

  it("activates only once under concurrent duplicate callbacks", async () => {
    const user = await createApiUser("MIDAMT06");
    const order = await createOrderFor(user, "SILVER");

    const [a, b] = await Promise.all([
      postSettlement(order.invoiceNumber, "500000.00"),
      postSettlement(order.invoiceNumber, "500000.00")
    ]);

    expect([a.status, b.status].every((s) => s === 200)).toBe(true);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
  });

  it("does not activate or credit on a pending callback", async () => {
    const user = await createApiUser("MIDAMT07");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "pending",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "201",
      gross_amount: "500000.00"
    });

    expect(response.status).toBe(200);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("does not activate or credit on a deny callback", async () => {
    const user = await createApiUser("MIDAMT08");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "deny",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "202",
      gross_amount: "500000.00"
    });

    expect(response.status).toBe(200);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  // B. Strict gross_amount format — tolak seluruh representasi non-standar
  // meski ber-signature valid.
  it.each([
    ["scientific notation", "5e5"],
    ["hexadecimal", "0x7A120"],
    ["underscore", "500_000"],
    ["comma separator", "500000,00"],
    ["leading/trailing whitespace", " 500000 "],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["three decimals", "500000.000"],
    ["negative", "-500000"],
    ["zero", "0.00"]
  ])("rejects %s gross_amount without activating", async (_label, amount) => {
    const user = await createApiUser("FMT");
    const order = await createOrderFor(user, "SILVER");

    const response = await postSettlement(order.invoiceNumber, amount);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("rejects a non-IDR currency without activating", async () => {
    const user = await createApiUser("CUR1");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotificationRaw({
      order_id: order.invoiceNumber,
      transaction_status: "settlement",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "200",
      gross_amount: "500000.00",
      currency: "USD"
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("accepts an explicit IDR currency with a matching amount", async () => {
    const user = await createApiUser("CUR2");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotificationRaw({
      order_id: order.invoiceNumber,
      transaction_status: "settlement",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "200",
      gross_amount: "500000.00",
      currency: "IDR"
    });

    expect(response.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
  });

  // -------------------------------------------------------------------------
  // Signature WAJIB, tanpa memandang NODE_ENV.
  //
  // Bentuk sebelumnya menerima notifikasi TANPA signature_key begitu saja
  // selama NODE_ENV bukan "production" — dan endpoint ini tidak memerlukan
  // autentikasi. Cukup nomor invoice dan nominalnya untuk melunasi order orang
  // lain beserta seluruh bonusnya. Uji ini berjalan dengan NODE_ENV=test,
  // sehingga ia gagal pada kode lama dan lulus pada kode yang sudah diperbaiki.
  // -------------------------------------------------------------------------

  it("menolak notifikasi tanpa signature_key dan tidak mengaktifkan apa pun", async () => {
    const user = await createApiUser("SIG001");
    const order = await createOrderFor(user, "SILVER");

    const response = await api("/api/v1/payments/midtrans/notification", {
      method: "POST",
      body: {
        order_id: order.invoiceNumber,
        transaction_status: "settlement",
        transaction_id: `tx-${order.invoiceNumber}`,
        status_code: "200",
        gross_amount: "500000.00"
        // signature_key sengaja tidak dikirim
      }
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it.each([
    ["status_code", "status_code"],
    ["gross_amount", "gross_amount"]
  ])(
    "menolak notifikasi tanpa %s karena signature tidak dapat dihitung",
    async (_label, field) => {
      const user = await createApiUser("SIG");
      const order = await createOrderFor(user, "SILVER");

      const body: Record<string, unknown> = {
        order_id: order.invoiceNumber,
        transaction_status: "settlement",
        transaction_id: `tx-${order.invoiceNumber}`,
        status_code: "200",
        gross_amount: "500000.00",
        signature_key: midtransSignature(order.invoiceNumber, "200", "500000.00")
      };
      delete body[field];

      const response = await api("/api/v1/payments/midtrans/notification", {
        method: "POST",
        body
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      await expectUnpaidNoSideEffects(order.id, user.id);
    }
  );

  // -------------------------------------------------------------------------
  // Fraud screening Midtrans.
  //
  // "capture" dulu ada di dalam successStatuses SEKALIGUS punya cabang khusus
  // sesudahnya, sehingga cabang fraud-nya mati total. Akibatnya transaksi kartu
  // yang ditahan FDS Midtrans untuk peninjauan manual justru langsung diaktifkan
  // sebagai lunas.
  // -------------------------------------------------------------------------

  it("tidak mengaktifkan capture yang ditandai fraud challenge", async () => {
    const user = await createApiUser("FRD001");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "capture",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "200",
      gross_amount: "500000.00",
      fraud_status: "challenge"
    });

    // Ditahan, bukan gagal: order tetap menunggu keputusan peninjauan manual.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { status: string } };
    expect(body.data.status).toBe("PENDING");
    await expectUnpaidNoSideEffects(order.id, user.id);
  });

  it("tidak mengaktifkan capture yang ditolak fraud screening", async () => {
    const user = await createApiUser("FRD002");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "capture",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "202",
      gross_amount: "500000.00",
      fraud_status: "deny"
    });

    expect(response.status).toBe(200);
    await expectUnpaidNoSideEffects(order.id, user.id);
    const updated = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { invoice: true }
    });
    expect(updated.status).toBe("FAILED");
    expect(updated.invoice?.status).toBe("FAILED");
  });

  it("mengaktifkan capture yang lolos fraud screening", async () => {
    const user = await createApiUser("FRD003");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "capture",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "200",
      gross_amount: "500000.00",
      fraud_status: "accept"
    });

    expect(response.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
  });

  // Penandaan fraud berlaku juga untuk settlement, bukan hanya capture.
  it("tidak mengaktifkan settlement yang ditandai fraud challenge", async () => {
    const user = await createApiUser("FRD004");
    const order = await createOrderFor(user, "SILVER");

    const response = await postNotification({
      order_id: order.invoiceNumber,
      transaction_status: "settlement",
      transaction_id: `tx-${order.invoiceNumber}`,
      status_code: "200",
      gross_amount: "500000.00",
      fraud_status: "challenge"
    });

    expect(response.status).toBe(200);
    await expectUnpaidNoSideEffects(order.id, user.id);
  });
});

async function api(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

async function createApiUser(referralCode: string, role: UserRole = "USER"): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });

  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

async function createOrderFor(user: User, tier: MembershipTier) {
  const membershipPackage = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const response = await api("/api/v1/membership/orders", {
    method: "POST",
    token: tokenFor(user),
    body: { packageId: membershipPackage.id }
  });
  const body = await response.json() as { data: { id: string; invoice: { number: string } } };

  expect(response.status).toBe(201);
  return {
    id: body.data.id,
    invoiceNumber: body.data.invoice.number
  };
}

async function postSettlement(invoiceNumber: string, grossAmount: string) {
  return postNotification({
    order_id: invoiceNumber,
    transaction_status: "settlement",
    transaction_id: `tx-${invoiceNumber}`,
    status_code: "200",
    gross_amount: grossAmount
  });
}

async function postNotification(payload: {
  order_id: string;
  transaction_status: string;
  transaction_id: string;
  status_code: string;
  gross_amount: string;
  /** Hasil fraud screening Midtrans. Signature tidak mencakupnya. */
  fraud_status?: string;
}) {
  return api("/api/v1/payments/midtrans/notification", {
    method: "POST",
    body: {
      ...payload,
      signature_key: midtransSignature(payload.order_id, payload.status_code, payload.gross_amount)
    }
  });
}

async function postNotificationRaw(payload: {
  order_id: string;
  transaction_status: string;
  transaction_id: string;
  status_code: string;
  gross_amount: string;
  currency?: string;
}) {
  return api("/api/v1/payments/midtrans/notification", {
    method: "POST",
    body: {
      ...payload,
      // Signature Midtrans tidak mencakup currency.
      signature_key: midtransSignature(payload.order_id, payload.status_code, payload.gross_amount)
    }
  });
}

function midtransSignature(orderId: string, statusCode: string, grossAmount: string) {
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${midtransServerKey}`)
    .digest("hex");
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function expectPaidOrder(orderId: string, userId: string, tier: MembershipTier) {
  const order = await prisma.membershipOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      invoice: true,
      userMembership: { include: { membership: true } }
    }
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: true }
  });

  expect(order.status).toBe("PAID");
  expect(order.invoice?.status).toBe("PAID");
  expect(order.userMembership?.status).toBe("ACTIVE");
  expect(order.userMembership?.membership.tier).toBe(tier);
  expect(user.membership?.tier).toBe(tier);
}

async function expectWalletBalance(userId: string, amount: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  expect(wallet.ppobBalance.toFixed(2)).toBe(amount);
  expect(wallet.cashBalance.toFixed(2)).toBe("0.00");
  expect(wallet.balance.toFixed(2)).toBe("0.00");
}

async function expectWalletTransactionCount(userId: string, type: "PPOB_BENEFIT", count: number) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, type }
  });
  expect(transactions).toHaveLength(count);
}

async function expectUnpaidNoSideEffects(orderId: string, userId: string) {
  const order = await prisma.membershipOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { invoice: true, userMembership: true }
  });
  expect(order.status).not.toBe("PAID");
  expect(order.userMembership).toBeNull();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: true }
  });
  expect(user.membership?.tier).toBe("BASIC");

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (wallet) {
    expect(wallet.ppobBalance.toFixed(2)).toBe("0.00");
    const ppobTransactions = await prisma.walletTransaction.count({
      where: { walletId: wallet.id, type: "PPOB_BENEFIT" }
    });
    expect(ppobTransactions).toBe(0);
  }
}
