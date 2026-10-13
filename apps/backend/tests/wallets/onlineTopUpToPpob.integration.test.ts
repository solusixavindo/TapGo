import { createHash } from "node:crypto";
import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanDatabase, prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter, paymentRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * Alur uang dari ujung ke ujung: pelanggan top up online (Midtrans) lalu membayar PPOB dan tagihan
 * dari saldo itu. Saldo PPOB hanya diisi lewat top up bertujuan PPOB; top up Saldo TapGo tidak
 * pernah bisa membayar PPOB, dan aplikasi tidak boleh dijanjikan sebaliknya oleh inquiry.
 */
const SERVER_KEY = "test-midtrans-server-key-for-topup-ppob";
const realFetch = globalThis.fetch;
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string; channel?: "APP" | "WEB" }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let sequence = 0;
const saved = { topUp: undefined as boolean | undefined, key: undefined as string | undefined };

describe.skipIf(!runIntegration)("Top up online lalu bayar PPOB dan tagihan", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "topup-ppob-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "topup-ppob-refresh-secret-00000000";
    process.env.PPOB_PROVIDER = "stub";
    process.env.PPOB_POSTPAID_SERVICE_FEE = "1000";
    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    saved.topUp = backendEnv.WALLET_TOPUP_ENABLED;
    saved.key = backendEnv.MIDTRANS_SERVER_KEY;
    backendEnv.WALLET_TOPUP_ENABLED = true;
    backendEnv.MIDTRANS_SERVER_KEY = SERVER_KEY;
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      apiRateLimiter.resetKey(key);
      paymentRateLimiter.resetKey(key);
    }
    await cleanDatabase();
    await prisma.ppobBillInquiry.deleteMany();
    await prisma.ppobTransaction.deleteMany();
    await prisma.ppobProduct.deleteMany();
    for (const row of [
      { sku: "PULSA_TSEL_10", category: "PULSA" as const, brand: "Telkomsel", name: "Pulsa Telkomsel 10.000", price: "11500", postpaid: false, providerSku: null },
      { sku: "PSC_BPJS00000001", category: "BPJS" as const, brand: "BPJS KESEHATAN", name: "BPJS KESEHATAN", price: "0", postpaid: true, providerSku: "bpjs" }
    ]) {
      await prisma.ppobProduct.create({
        data: {
          sku: row.sku, category: row.category, brand: row.brand, name: row.name,
          price: new Prisma.Decimal(row.price), adminFee: new Prisma.Decimal("0"),
          isPostpaid: row.postpaid, providerSku: row.providerSku, isActive: true
        }
      });
    }
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/snap/v1/transactions")) return realFetch(input, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as { transaction_details: { gross_amount: number } };
      expect(body.transaction_details.gross_amount).toBeGreaterThan(0);
      return new Response(JSON.stringify({ token: "snap-token", redirect_url: "https://app.midtrans.com/snap/v4/redirection/snap-token" }), { status: 201 });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    backendEnv.WALLET_TOPUP_ENABLED = saved.topUp ?? false;
    backendEnv.MIDTRANS_SERVER_KEY = saved.key;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((e) => (e ? reject(e) : resolve()));
    });
  });

  async function topUpAndSettle(user: User, amount: number, target: "WALLET" | "PPOB") {
    const created = await api("/api/v1/web/wallet/topup/online", { method: "POST", token: tokenFor(user, "WEB"), body: { amount, target } });
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { reference: string; grossAmount: number } };
    expect(data.grossAmount).toBe(amount + 4440);
    const orderId = data.reference;
    const grossAmount = `${data.grossAmount}.00`;
    const signature = createHash("sha512").update(`${orderId}200${grossAmount}${SERVER_KEY}`).digest("hex");
    const settled = await api("/api/v1/payments/midtrans/notification", {
      method: "POST",
      body: { order_id: orderId, transaction_id: `txn-${orderId}`, transaction_status: "settlement", status_code: "200", gross_amount: grossAmount, currency: "IDR", payment_type: "bank_transfer", signature_key: signature }
    });
    expect(settled.status).toBe(200);
  }

  async function wallet(userId: string) {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return { balance: w.balance.toFixed(2), ppob: w.ppobBalance.toFixed(2) };
  }

  it("top up Saldo PPOB lalu beli pulsa: saldo PPOB bertambah nominal saja dan berkurang tepat harga produk", async () => {
    const user = await createUser();
    await topUpAndSettle(user, 50000, "PPOB");
    expect(await wallet(user.id)).toEqual({ balance: "0.00", ppob: "50000.00" });

    const inquiry = await api("/api/v1/ppob/orders/inquiry", { method: "POST", token: tokenFor(user, "APP"), body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" } });
    const payment = ((await inquiry.json()) as { data: { payment: unknown } }).data.payment;
    expect(payment).toEqual({ amount: 11500, benefitAmount: 11500, balanceAmount: 0, sufficient: true });

    const bought = await api("/api/v1/ppob/orders", { method: "POST", token: tokenFor(user, "APP"), idempotencyKey: "e2e-pulsa-1", body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" } });
    expect(bought.status).toBe(201);
    expect(((await bought.json()) as { data: { status: string } }).data.status).toBe("SUCCESS");
    expect(await wallet(user.id)).toEqual({ balance: "0.00", ppob: "38500.00" });
  });

  it("top up Saldo TapGo TIDAK membayar PPOB: inquiry jujur (tidak cukup) dan pembelian ditolak tanpa mengubah saldo", async () => {
    const user = await createUser();
    await topUpAndSettle(user, 100000, "WALLET");
    expect(await wallet(user.id)).toEqual({ balance: "100000.00", ppob: "0.00" });

    const inquiry = await api("/api/v1/ppob/orders/inquiry", { method: "POST", token: tokenFor(user, "APP"), body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" } });
    expect(((await inquiry.json()) as { data: { payment: { sufficient: boolean } } }).data.payment.sufficient).toBe(false);

    const bought = await api("/api/v1/ppob/orders", { method: "POST", token: tokenFor(user, "APP"), idempotencyKey: "e2e-pulsa-2", body: { sku: "PULSA_TSEL_10", targetNumber: "085612345678" } });
    expect(bought.status).toBeGreaterThanOrEqual(400);
    expect(await wallet(user.id)).toEqual({ balance: "100000.00", ppob: "0.00" });
    expect(await prisma.ppobTransaction.count()).toBe(0);
  });

  it("top up Saldo PPOB lalu bayar tagihan BPJS: total Rp102.350 dipotong dari saldo PPOB", async () => {
    const user = await createUser();
    await topUpAndSettle(user, 200000, "PPOB");
    const inquiry = await api("/api/v1/ppob/bills/inquiry", { method: "POST", token: tokenFor(user, "APP"), body: { sku: "PSC_BPJS00000001", targetNumber: "1234567890123" } });
    expect(inquiry.status).toBe(200);
    const { reference, totalAmount, sufficient } = ((await inquiry.json()) as { data: { reference: string; totalAmount: number; sufficient: boolean } }).data;
    expect(totalAmount).toBe(102350);
    expect(sufficient).toBe(true);
    const paid = await api("/api/v1/ppob/bills/pay", { method: "POST", token: tokenFor(user, "APP"), idempotencyKey: "e2e-bpjs-1", body: { reference } });
    expect(paid.status).toBeLessThan(300);
    expect(await wallet(user.id)).toEqual({ balance: "0.00", ppob: "97650.00" });
  });

  async function createUser(): Promise<User> {
    sequence += 1;
    return prisma.user.create({
      data: { fullName: `E2E ${sequence}`, phone: `+6286${String(sequence).padStart(9, "0")}`, referralCode: `E2E${String(sequence).padStart(6, "0")}`, role: "USER" }
    });
  }

  function tokenFor(user: User, channel: "APP" | "WEB") {
    return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}`, channel });
  }

  async function api(path: string, options: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {}) {
    return realFetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
  }
});
