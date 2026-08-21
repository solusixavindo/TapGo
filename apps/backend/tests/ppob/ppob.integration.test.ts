import { Prisma, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter, paymentRateLimiter } from "../../src/core/security/rateLimit.js";
import { STUB_FAILURE_TARGET_SUFFIX } from "../../src/modules/ppob/infrastructure/StubPpobProvider.js";

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    paymentRateLimiter.resetKey(key);
  }
}

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Stage R2.7 — PPOB foundation", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "ppob-foundation-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "ppob-foundation-refresh-secret-00000000";
    // Adapter stub deterministik: kegagalan hanya lewat nomor sentinel.
    process.env.PPOB_PROVIDER = "stub";

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
    await cleanPpobTables();
    await seedCatalog();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- Katalog ---------------------------------------------------------------

  it("katalog hanya menyajikan produk aktif, terurut, dan dapat difilter kategori", async () => {
    const user = await createUser("USER");

    const all = await api("/api/v1/ppob/products", { token: tokenFor(user) });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { data: any[] };
    const skus = allBody.data.map((p) => p.sku);
    expect(skus).toContain("PULSA_TSEL_10");
    expect(skus).not.toContain("PULSA_INACTIVE");
    // Tidak ada field internal (id, isActive, sortOrder) yang bocor.
    expect(allBody.data[0]).not.toHaveProperty("id");
    expect(allBody.data[0]).not.toHaveProperty("isActive");

    const pulsaOnly = await api("/api/v1/ppob/products?category=PULSA", {
      token: tokenFor(user)
    });
    const pulsaBody = (await pulsaOnly.json()) as { data: any[] };
    expect(pulsaBody.data.every((p) => p.category === "PULSA")).toBe(true);
  });

  it("menolak kategori tak dikenal dan permintaan tanpa token", async () => {
    const user = await createUser("USER");
    const badCategory = await api("/api/v1/ppob/products?category=STREAMING", {
      token: tokenFor(user)
    });
    expect(badCategory.status).toBe(400);

    const anonymous = await api("/api/v1/ppob/products");
    expect(anonymous.status).toBe(401);
  });

  // --- Pembelian sukses --------------------------------------------------------

  it("pembelian sukses: debit ppobBalance sekali, ledger lengkap, serial terbit", async () => {
    const user = await createUserWithPpobBalance("100000");

    const res = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-success-1",
      body: { sku: "PULSA_TSEL_10", targetNumber: "+6285612345678" }
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: any };

    expect(body.data.reference).toMatch(/^PPB-[A-Z2-9]{10}$/);
    expect(body.data.status).toBe("SUCCESS");
    expect(body.data.targetNumber).toBe("085612345678");
    expect(body.data.totalAmount).toBe(11500);
    expect(body.data.serialNumber).toBe(`STUB-SN-${body.data.reference.slice(4)}`);
    // Field internal tidak pernah disajikan.
    for (const internal of ["userId", "productId", "provider", "providerReference", "idempotencyKey", "walletTransactionId"]) {
      expect(body.data).not.toHaveProperty(internal);
    }

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("88500.00");
    // ppobBalance adalah bucket non-withdrawable: balance TIDAK ikut terdebit.
    expect(wallet.balance.toFixed(2)).toBe("0.00");

    const ledger = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id }
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe("PPOB_PURCHASE");
    expect(ledger[0]!.amount.toFixed(2)).toBe("-11500.00");
    expect(ledger[0]!.referenceId).toBe(body.data.reference);
  });

  it("replay Idempotency-Key mengembalikan transaksi yang sama tanpa debit kedua", async () => {
    const user = await createUserWithPpobBalance("100000");
    const payload = { sku: "PULSA_TSEL_10", targetNumber: "6285612345678" };

    const first = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-replay-1",
      body: payload
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data: any };

    // Bentuk nomor berbeda ("0856…"), nomor ternormalisasi sama -> replay.
    const second = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-replay-1",
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data: any };
    expect(secondBody.data.reference).toBe(firstBody.data.reference);
    expect(secondBody.data.serialNumber).toBe(firstBody.data.serialNumber);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("88500.00");
    const ledgerCount = await prisma.walletTransaction.count({
      where: { walletId: wallet.id }
    });
    expect(ledgerCount).toBe(1);
  });

  it("Idempotency-Key sama dengan payload berbeda ditolak 409", async () => {
    const user = await createUserWithPpobBalance("100000");

    await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-conflict-1",
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });

    const conflict = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-conflict-1",
      body: { sku: "PULSA_TSEL_25", targetNumber: "085612345678" }
    });
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { code?: string };
    expect(body.code).toBe("PPOB_IDEMPOTENCY_CONFLICT");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("88500.00");
  });

  // --- Penolakan yang aman ----------------------------------------------------

  it("saldo tidak cukup: 400 tanpa transaksi dan tanpa ledger tersisa", async () => {
    const user = await createUserWithPpobBalance("5000");

    const res = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("INSUFFICIENT_PPOB_BALANCE");

    expect(await prisma.ppobTransaction.count({ where: { userId: user.id } })).toBe(0);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("5000.00");
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id } })).toBe(0);
  });

  it("sku tidak dikenal -> 404, target tidak valid -> 400, tanpa menyentuh saldo", async () => {
    const user = await createUserWithPpobBalance("100000");

    const unknownSku = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_HANTU_10", targetNumber: "085612345678" }
    });
    expect(unknownSku.status).toBe(404);
    expect(((await unknownSku.json()) as { code?: string }).code).toBe("PPOB_PRODUCT_NOT_FOUND");

    const badTarget = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PULSA_TSEL_10", targetNumber: "0712345678" }
    });
    expect(badTarget.status).toBe(400);
    expect(((await badTarget.json()) as { code?: string }).code).toBe("PPOB_TARGET_INVALID");

    const badPln = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      body: { sku: "PLN_TOKEN_20", targetNumber: "12345" }
    });
    expect(badPln.status).toBe(400);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("100000.00");
    expect(await prisma.ppobTransaction.count({ where: { userId: user.id } })).toBe(0);
  });

  // --- Jalur kegagalan & refund -------------------------------------------------

  it("kegagalan provider (nomor sentinel): FAILED + refund penuh + ledger PPOB_REFUND", async () => {
    const user = await createUserWithPpobBalance("100000");
    const sentinelTarget = `085612${STUB_FAILURE_TARGET_SUFFIX}`;

    const res = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-fail-1",
      body: { sku: "PULSA_TSEL_10", targetNumber: sentinelTarget }
    });
    // Pembelian DITERIMA (201) tetapi hasil akhirnya FAILED dengan refund.
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: any };
    expect(body.data.status).toBe("FAILED");
    expect(body.data.failureCode).toBe("STUB_FORCED_FAILURE");
    expect(body.data.serialNumber).toBeNull();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("100000.00");

    const ledger = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "asc" }
    });
    expect(ledger.map((row) => row.type)).toEqual(["PPOB_PURCHASE", "PPOB_REFUND"]);
    expect(ledger[1]!.amount.toFixed(2)).toBe("11500.00");

    // Replay idempotency pada transaksi FAILED mengembalikan hasil yang sama,
    // BUKAN mencoba pembelian ulang.
    const replay = await api("/api/v1/ppob/transactions", {
      method: "POST",
      token: tokenFor(user),
      idempotencyKey: "purchase-fail-1",
      body: { sku: "PULSA_TSEL_10", targetNumber: sentinelTarget }
    });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { data: any }).data.status).toBe("FAILED");

    const refundCount = await prisma.walletTransaction.count({
      where: { walletId: wallet.id, type: "PPOB_REFUND" }
    });
    expect(refundCount).toBe(1);
  });

  it("provider disabled (service-level): 503, refund penuh, transaksi FAILED", async () => {
    // Adapter disabled tidak dapat dipasang lewat HTTP karena env dibaca sekali
    // saat boot; jalurnya diuji pada service NYATA dengan repository NYATA
    // (tanpa mock) — sama seperti yang dipakai resolvePpobProvider() default.
    const { PpobService } = await import("../../src/modules/ppob/application/PpobService.js");
    const { PrismaPpobRepository } = await import(
      "../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"
    );
    const { DisabledPpobProvider } = await import(
      "../../src/modules/ppob/infrastructure/DisabledPpobProvider.js"
    );

    const service = new PpobService(new PrismaPpobRepository(prisma), new DisabledPpobProvider());
    const user = await createUserWithPpobBalance("100000");

    await expect(
      service.purchase({
        userId: user.id,
        sku: "PULSA_TSEL_10",
        targetNumber: "085612345678"
      })
    ).rejects.toMatchObject({ statusCode: 503, code: "PPOB_PROVIDER_DISABLED" });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("100000.00");

    const transaction = await prisma.ppobTransaction.findFirstOrThrow({
      where: { userId: user.id }
    });
    expect(transaction.status).toBe("FAILED");
    expect(transaction.failureCode).toBe("PROVIDER_DISABLED");
  });

  // --- Histori & isolasi ---------------------------------------------------------

  it("histori terurut terbaru dulu dan detail milik orang lain menjawab 404", async () => {
    const user = await createUserWithPpobBalance("500000");
    const other = await createUser("USER");

    for (const [index, sku] of ["PULSA_TSEL_10", "PLN_TOKEN_20"].entries()) {
      await api("/api/v1/ppob/transactions", {
        method: "POST",
        token: tokenFor(user),
        idempotencyKey: `history-${index}`,
        body: {
          sku,
          targetNumber: sku.startsWith("PLN") ? "12345678901" : "085612345678"
        }
      });
    }

    const history = await api("/api/v1/ppob/transactions", { token: tokenFor(user) });
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as { data: any[] };
    expect(historyBody.data).toHaveLength(2);
    expect(historyBody.data[0]!.sku).toBe("PLN_TOKEN_20");
    expect(historyBody.data[1]!.sku).toBe("PULSA_TSEL_10");

    const reference = historyBody.data[1]!.reference;
    const detail = await api(`/api/v1/ppob/transactions/${reference}`, {
      token: tokenFor(user)
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { data: any }).data.reference).toBe(reference);

    const stolen = await api(`/api/v1/ppob/transactions/${reference}`, {
      token: tokenFor(other)
    });
    expect(stolen.status).toBe(404);
    expect(((await stolen.json()) as { code?: string }).code).toBe(
      "PPOB_TRANSACTION_NOT_FOUND"
    );

    const malformed = await api("/api/v1/ppob/transactions/BUKAN-REFERENSI", {
      token: tokenFor(user)
    });
    expect(malformed.status).toBe(400);
  });

  it("pembelian tanpa token ditolak 401", async () => {
    const res = await api("/api/v1/ppob/transactions", {
      method: "POST",
      body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" }
    });
    expect(res.status).toBe(401);
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
  const products: Array<{
    sku: string;
    category: "PULSA" | "DATA" | "PLN_PREPAID" | "PLN_POSTPAID" | "BPJS" | "EWALLET";
    brand: string;
    name: string;
    price: string;
    adminFee?: string;
    isActive?: boolean;
    sortOrder?: number;
  }> = [
    { sku: "PULSA_TSEL_10", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 10.000", price: "11500", sortOrder: 1 },
    { sku: "PULSA_TSEL_25", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 25.000", price: "26500", sortOrder: 2 },
    { sku: "PLN_TOKEN_20", category: "PLN_PREPAID", brand: "PLN", name: "Token PLN 20.000", price: "20500", sortOrder: 3 },
    { sku: "PULSA_INACTIVE", category: "PULSA", brand: "Telkomsel", name: "Produk nonaktif", price: "1", isActive: false, sortOrder: 99 }
  ];

  for (const product of products) {
    await prisma.ppobProduct.create({
      data: {
        sku: product.sku,
        category: product.category,
        brand: product.brand,
        name: product.name,
        price: new Prisma.Decimal(product.price),
        adminFee: new Prisma.Decimal(product.adminFee ?? "0"),
        isActive: product.isActive ?? true,
        sortOrder: product.sortOrder ?? 0
      }
    });
  }
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `PPOB User ${sequence}`,
      phone: `+6287${String(sequence).padStart(9, "0")}`,
      referralCode: `PPOB${String(sequence).padStart(6, "0")}`,
      role
    }
  });
}

async function createUserWithPpobBalance(amount: string) {
  const user = await createUser("USER");
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
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
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
