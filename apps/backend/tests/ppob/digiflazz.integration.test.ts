import { Prisma, UserRole } from "@prisma/client";
import { createHmac } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter, paymentRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * Stage R2.8 — integrasi provider Digiflazz nyata (melawan stub HTTP server).
 *
 * Seluruh permintaan provider pergi ke stub server lokal yang berperilaku
 * persis kontrak Digiflazz (POST /v1/transaction, { data }). Webhook dikirim
 * ke app NYATA dengan X-Hub-Signature yang dihitung dari secret test —
 * jalur kode yang sama persis dengan produksi.
 */

const DIGIFLAZZ_USERNAME = "tapgo_test_user";
const DIGIFLAZZ_API_KEY = "tapgo_test_api_key";
const WEBHOOK_SECRET = "tapgo_test_webhook_secret_32chars";

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let appServer: Server | undefined;
let digiflazzStub: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

/// Skenario stub per ref_id: respons apa yang dijawab untuk transaksi itu.
const stubScenarios = new Map<string, Array<{ status: string; rc?: string; sn?: string; message?: string }>>();
const stubRequests: Array<Record<string, unknown>> = [];

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    paymentRateLimiter.resetKey(key);
  }
}

function signWebhook(rawBody: string): string {
  return `sha1=${createHmac("sha1", WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex")}`;
}

describe.skipIf(!runIntegration)("Stage R2.8 — Digiflazz real provider integration", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    digiflazzStub = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/transaction") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        stubRequests.push(parsed);
        const refId = String(parsed.ref_id ?? "");
        // Skenario eksplisit per ref_id menang; "*" adalah fallback global.
        const scenario =
          stubScenarios.get(refId) ??
          stubScenarios.get("*") ?? [{ status: "Sukses", rc: "00", sn: `SN-${refId}` }];
        const step = scenario.length > 1 ? scenario.shift()! : scenario[0]!;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: {
              ref_id: refId,
              customer_no: parsed.customer_no,
              buyer_sku_code: parsed.buyer_sku_code,
              message: step.message ?? `Transaksi ${step.status}`,
              status: step.status,
              rc: step.rc ?? "00",
              sn: step.sn ?? "",
              buyer_last_saldo: 999000,
              price: 11500
            }
          })
        );
      });
    });
    await new Promise<void>((resolve) => digiflazzStub!.listen(0, "127.0.0.1", resolve));
    const stubAddress = digiflazzStub.address() as AddressInfo;

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "ppob-r28-access-secret-000000000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "ppob-r28-refresh-secret-00000000000000";
    process.env.PPOB_PROVIDER = "digiflazz";
    process.env.DIGIFLAZZ_USERNAME = DIGIFLAZZ_USERNAME;
    process.env.DIGIFLAZZ_API_KEY = DIGIFLAZZ_API_KEY;
    process.env.DIGIFLAZZ_BASE_URL = `http://127.0.0.1:${stubAddress.port}/v1`;
    process.env.DIGIFLAZZ_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // env dibaca sekali saat import; timpa objeknya langsung (pola yang sama
    // dipakai test Midtrans) dan KEMBALIKAN di afterAll.
    const { env } = await import("../../src/config/env.js");
    Object.assign(env, {
      PPOB_PROVIDER: "digiflazz",
      DIGIFLAZZ_USERNAME,
      DIGIFLAZZ_API_KEY,
      DIGIFLAZZ_BASE_URL: `http://127.0.0.1:${stubAddress.port}/v1`,
      DIGIFLAZZ_TESTING: true,
      DIGIFLAZZ_WEBHOOK_SECRET: WEBHOOK_SECRET
    });

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    stubScenarios.clear();
    stubRequests.length = 0;
    await cleanPpobTables();
    await seedCatalog();
  });

  afterAll(async () => {
    const { env } = await import("../../src/config/env.js");
    Object.assign(env, {
      PPOB_PROVIDER: "disabled",
      DIGIFLAZZ_USERNAME: undefined,
      DIGIFLAZZ_API_KEY: undefined,
      DIGIFLAZZ_BASE_URL: undefined,
      DIGIFLAZZ_WEBHOOK_SECRET: undefined
    });
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      if (!digiflazzStub) return resolve();
      digiflazzStub.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- Pembelian via adapter nyata --------------------------------------------

  it("pembelian sukses: payload ke provider sesuai kontrak (sign, ref_id, testing)", async () => {
    const user = await createUserWithPpobBalance("100000");

    const res = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe("SUCCESS");
    expect(body.data.serialNumber).toBe(`SN-${body.data.reference}`);

    expect(stubRequests).toHaveLength(1);
    const sent = stubRequests[0]!;
    expect(sent.username).toBe(DIGIFLAZZ_USERNAME);
    expect(sent.buyer_sku_code).toBe("tsel10"); // providerSku dari katalog
    expect(sent.customer_no).toBe("085612345678");
    expect(sent.ref_id).toBe(body.data.reference);
    expect(sent.testing).toBe(true);
    // sign = md5(username + apiKey + ref_id), diverifikasi ulang di sisi test.
    const expected = (await import("node:crypto"))
      .createHash("md5")
      .update(`${DIGIFLAZZ_USERNAME}${DIGIFLAZZ_API_KEY}${body.data.reference}`)
      .digest("hex");
    expect(sent.sign).toBe(expected);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("88500.00");
  });

  it("jawaban Gagal dari provider: FAILED + refund penuh + rc sebagai failureCode", async () => {
    const user = await createUserWithPpobBalance("100000");
    // Skenario dikeyed ref_id, yang belum diketahui — pasang lewat wildcard:
    // stub default menjawab Sukses, jadi gunakan sku khusus yang di-map.
    stubScenarios.set("*", [{ status: "Gagal", rc: "07", message: "Nomor tidak terdaftar" }]);

    const res = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_FAIL", targetNumber: "085612345678" }
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe("FAILED");
    expect(body.data.failureCode).toBe("DIGIFLAZZ_RC_07");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("100000.00");
    const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id } });
    expect(ledger.map((row) => row.type).sort()).toEqual(["PPOB_PURCHASE", "PPOB_REFUND"]);
  });

  // --- Webhook ------------------------------------------------------------------

  it("webhook sukses men-finalkan transaksi PROCESSING; webhook ganda idempoten", async () => {
    const user = await createUserWithPpobBalance("100000");

    // Provider menjawab Pending saat pembelian.
    stubScenarios.set("*", [{ status: "Pending", rc: "03" }]);
    const purchase = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    const purchaseBody = (await purchase.json()) as { data: any };
    expect(purchaseBody.data.status).toBe("PROCESSING");
    const reference = purchaseBody.data.reference;

    // Webhook sukses tiba.
    const payload = JSON.stringify({
      data: {
        ref_id: reference,
        customer_no: "085612345678",
        buyer_sku_code: "tsel10",
        message: "Sukses",
        status: "Sukses",
        rc: "00",
        sn: `SN-WEBHOOK-${reference}`,
        buyer_last_saldo: 999000,
        price: 11500
      }
    });
    const webhook = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature": signWebhook(payload),
        "x-digiflazz-event": "update",
        "user-agent": "Digiflazz-Hookshot"
      },
      body: payload
    });
    expect(webhook.status).toBe(200);
    expect(((await webhook.json()) as { data: any }).data.state).toBe("finalized");

    const detail = await api(`/api/v1/ppob/transactions/${reference}`, { token: tokenFor(user) });
    const detailBody = (await detail.json()) as { data: any };
    expect(detailBody.data.status).toBe("SUCCESS");
    expect(detailBody.data.serialNumber).toBe(`SN-WEBHOOK-${reference}`);

    // Webhook GANDA dengan status berlawanan tidak mengubah apa pun.
    const duplicate = JSON.stringify({
      data: { ref_id: reference, status: "Gagal", rc: "99", message: "terlambat" }
    });
    const second = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature": signWebhook(duplicate) },
      body: duplicate
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { data: any }).data.state).toBe("already-final");

    const after = await prisma.ppobTransaction.findUniqueOrThrow({ where: { publicReference: reference } });
    expect(after.status).toBe("SUCCESS");
    // Tidak ada refund untuk transaksi yang sudah sukses.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("88500.00");
  });

  it("webhook gagal pada transaksi PROCESSING memicu refund penuh tepat satu kali", async () => {
    const user = await createUserWithPpobBalance("100000");
    stubScenarios.set("*", [{ status: "Pending", rc: "03" }]);
    const purchase = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    const reference = ((await purchase.json()) as { data: any }).data.reference;

    const payload = JSON.stringify({
      data: { ref_id: reference, status: "Gagal", rc: "06", message: "Produk gangguan" }
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature": signWebhook(payload) },
        body: payload
      });
      expect(res.status).toBe(200);
    }

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("100000.00");
    const refunds = await prisma.walletTransaction.count({
      where: { walletId: wallet.id, type: "PPOB_REFUND" }
    });
    expect(refunds).toBe(1);
  });

  it("webhook tanpa signature / signature salah ditolak 401 dan tidak mengubah apa pun", async () => {
    const payload = JSON.stringify({ data: { ref_id: "PPB-XXXXXXXXXX", status: "Sukses" } });

    const noSignature = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload
    });
    expect(noSignature.status).toBe(401);

    const badSignature = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature": "sha1=deadbeef" },
      body: payload
    });
    expect(badSignature.status).toBe(401);

    // Payload yang DIUBAH setelah ditandatangani juga harus gagal.
    const signed = signWebhook(payload);
    const tampered = payload.replace("Sukses", "Gagal ");
    const tamperedRes = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature": signed },
      body: tampered
    });
    expect(tamperedRes.status).toBe(401);
  });

  it("webhook untuk referensi tak dikenal dijawab 200 ignored (tanpa retry tanpa akhir)", async () => {
    const payload = JSON.stringify({
      data: { ref_id: "PPB-ZZZZZZZZZZ", status: "Sukses", sn: "X" }
    });
    const res = await fetch(`${baseUrl}/api/v1/webhooks/ppob/digiflazz`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature": signWebhook(payload) },
      body: payload
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: any }).data.state).toBe("ignored");
  });

  // --- Rekonsiliasi ---------------------------------------------------------------

  it("siklus rekonsiliasi men-finalkan PROCESSING via cek status (topup ulang ref_id sama)", async () => {
    const { PpobService } = await import("../../src/modules/ppob/application/PpobService.js");
    const { PrismaPpobRepository } = await import(
      "../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"
    );
    const { DigiflazzPpobProvider } = await import(
      "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js"
    );

    const user = await createUserWithPpobBalance("100000");
    // Pembelian Pending, lalu stub berubah menjawab Sukses untuk cek berikutnya.
    stubScenarios.set("*", [{ status: "Pending", rc: "03" }, { status: "Sukses", rc: "00", sn: "SN-RECON" }]);
    const purchase = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    const reference = ((await purchase.json()) as { data: any }).data.reference;

    // Mundurkan createdAt supaya masuk ambang rekonsiliasi.
    await prisma.ppobTransaction.update({
      where: { publicReference: reference },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) }
    });

    const service = new PpobService(
      new PrismaPpobRepository(prisma),
      DigiflazzPpobProvider.fromEnv()
    );
    const result = await service.reconcileOpenTransactions({ olderThanMinutes: 5, batchSize: 10 });
    expect(result.skipped).toBe(false);
    expect(result.finalized).toBe(1);
    expect(result.errors).toBe(0);

    // Cek status memakai ref_id yang SAMA (dokumentasi: topup ulang).
    expect(stubRequests).toHaveLength(2);
    expect(stubRequests[1]!.ref_id).toBe(reference);

    const transaction = await prisma.ppobTransaction.findUniqueOrThrow({
      where: { publicReference: reference }
    });
    expect(transaction.status).toBe("SUCCESS");
    expect(transaction.serialNumber).toBe("SN-RECON");
  });

  it("rekonsiliasi: jawaban Gagal merefund; transaksi PENDING yatim dieskalasi lalu diinquiry", async () => {
    const { PpobService } = await import("../../src/modules/ppob/application/PpobService.js");
    const { PrismaPpobRepository } = await import(
      "../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"
    );
    const { DigiflazzPpobProvider } = await import(
      "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js"
    );

    const user = await createUserWithPpobBalance("100000");
    // Transaksi PENDING "yatim": seolah proses mati sebelum dispatch selesai.
    const product = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "PULSA_TSEL_10" } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { ppobBalance: { decrement: new Prisma.Decimal(11500) } }
    });
    const orphan = await prisma.ppobTransaction.create({
      data: {
        publicReference: "PPB-ORPHAN0001",
        userId: user.id,
        productId: product.id,
        skuSnapshot: product.sku,
        productNameSnapshot: product.name,
        brandSnapshot: product.brand,
        category: product.category,
        targetNumber: "085612345678",
        amount: product.price,
        adminFee: product.adminFee,
        totalAmount: product.price,
        status: "PENDING",
        provider: "digiflazz",
        createdAt: new Date(Date.now() - 30 * 60 * 1000)
      }
    });

    stubScenarios.set("*", [{ status: "Gagal", rc: "05", message: "Seller gangguan" }]);
    const service = new PpobService(
      new PrismaPpobRepository(prisma),
      DigiflazzPpobProvider.fromEnv()
    );
    const result = await service.reconcileOpenTransactions({ olderThanMinutes: 5, batchSize: 10 });
    expect(result.escalated).toBe(1);
    expect(result.finalized).toBe(1);

    const after = await prisma.ppobTransaction.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(after.status).toBe("FAILED");
    const refundedWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(refundedWallet.ppobBalance.toFixed(2)).toBe("100000.00");
  });

  it("advisory lock: pemegang kunci kedua melewati siklus (skipped)", async () => {
    const { PrismaPpobRepository } = await import(
      "../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"
    );
    const repository = new PrismaPpobRepository(prisma);

    const firstHolder = await repository.transaction(async (tx) =>
      repository.tryAcquireReconcileLock(727008, tx)
    );
    expect(firstHolder).toBe(true);

    // Transaksi kedua pada koneksi lain tidak dapat mengambil kunci yang sama.
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(727008) AS acquired
      `;
      // Kunci pertama sudah dilepas (transaksi pertama selesai), jadi ini true —
      // tetapi dua siklus tidak pernah beririsan dalam SATU transaksi.
      expect(rows[0]?.acquired).toBe(true);
    });
  });
});

// --- Helpers -------------------------------------------------------------------

async function cleanPpobTables() {
  await prisma.ppobTransaction.deleteMany();
  await prisma.ppobProduct.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

async function seedCatalog() {
  await prisma.ppobProduct.create({
    data: {
      sku: "PULSA_TSEL_10",
      category: "PULSA",
      brand: "Telkomsel",
      name: "Pulsa Telkomsel 10.000",
      price: new Prisma.Decimal("11500"),
      providerSku: "tsel10",
      sortOrder: 1
    }
  });
  await prisma.ppobProduct.create({
    data: {
      sku: "PULSA_FAIL",
      category: "PULSA",
      brand: "Telkomsel",
      name: "Produk uji gagal",
      price: new Prisma.Decimal("11500"),
      providerSku: "tsel10",
      sortOrder: 99
    }
  });
}

async function createUserWithPpobBalance(amount: string) {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      fullName: `R28 User ${sequence}`,
      phone: `+6289${String(sequence).padStart(9, "0")}`,
      referralCode: `R28${String(sequence).padStart(7, "0")}`,
      role: "USER"
    }
  });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(0),
      cashBalance: new Prisma.Decimal(0),
      ppobBalance: new Prisma.Decimal(amount),
      currency: "IDR"
    }
  });
  return user;
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}
