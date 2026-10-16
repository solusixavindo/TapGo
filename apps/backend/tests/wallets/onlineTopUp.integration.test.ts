import { createHash } from "node:crypto";
import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanDatabase,
  decimalString,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";
import { topUpOnlineFee } from "../../src/core/finance/midtransFees.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string; channel?: "APP" | "WEB" }) => string;

const SERVER_KEY = "test-midtrans-server-key-for-online-topup";
const realFetch = globalThis.fetch;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let snapRequests: Array<Record<string, unknown>> = [];
let snapShouldFail = false;
// Daftar metode Snap seperti di produksi (VA bank) ditambah metode persen yang sedang diaktifkan di Midtrans.
const ENABLED_PAYMENTS = "bni_va,bri_va,cimb_va,permata_va,echannel,gopay,other_qris";
const saved = {
  enabledPayments: undefined as string | undefined,
  topUpMethods: undefined as string | undefined,
  topUp: undefined as boolean | undefined,
  key: undefined as string | undefined,
  doku: undefined as boolean | undefined,
  manual: undefined as boolean | undefined
};

describe("topUpOnlineFee", () => {
  it("is Rp4.000 plus 11% VAT in whole rupiah", () => {
    expect(topUpOnlineFee()).toBe(4440);
  });
});

describe.skipIf(!runIntegration)("Online wallet top up (fee borne by the customer)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-online-topup";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-online-topup";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    saved.topUp = backendEnv.WALLET_TOPUP_ENABLED;
    saved.key = backendEnv.MIDTRANS_SERVER_KEY;
    saved.doku = backendEnv.DOKU_ENABLED;
    saved.manual = backendEnv.MANUAL_TOPUP_ENABLED;
    saved.enabledPayments = backendEnv.MIDTRANS_ENABLED_PAYMENTS;
    backendEnv.MIDTRANS_ENABLED_PAYMENTS = ENABLED_PAYMENTS;
    saved.topUpMethods = backendEnv.WALLET_TOPUP_METHODS;
    // Semua metode dinyalakan untuk uji per-metode; bawaan produksi (hanya transfer bank) diuji terpisah di bawah.
    backendEnv.WALLET_TOPUP_METHODS = "bank_transfer,gopay,qris,dana";
    backendEnv.WALLET_TOPUP_ENABLED = true;
    backendEnv.MIDTRANS_SERVER_KEY = SERVER_KEY;
    backendEnv.DOKU_ENABLED = false;
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    snapRequests = [];
    snapShouldFail = false;
    // Hanya panggilan ke Snap yang dicegat; permintaan ke server uji lokal tetap lewat.
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/snap/v1/transactions")) return realFetch(input, init);
      snapRequests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (snapShouldFail) {
        return new Response(JSON.stringify({ error_messages: ["boom"] }), { status: 500 });
      }
      const n = snapRequests.length;
      return new Response(JSON.stringify({ token: `snap-token-${n}`, redirect_url: `https://app.midtrans.com/snap/v4/redirection/snap-token-${n}` }), {
        status: 201
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (backendEnv) {
      backendEnv.WALLET_TOPUP_ENABLED = saved.topUp ?? false;
      backendEnv.MIDTRANS_SERVER_KEY = saved.key;
      backendEnv.DOKU_ENABLED = saved.doku ?? false;
      backendEnv.MANUAL_TOPUP_ENABLED = saved.manual ?? false;
      backendEnv.MIDTRANS_ENABLED_PAYMENTS = saved.enabledPayments;
      backendEnv.WALLET_TOPUP_METHODS = saved.topUpMethods ?? "bank_transfer";
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("offers the online option with the fee and the minimum per balance", async () => {
    const user = await createUser("ONL000001");
    const response = await api("/api/v1/web/wallet/topup/options", { token: tokenFor(user, "WEB") });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { online: boolean; onlineFee: number; minimum: { WALLET: number; PPOB: number }; maximum: number } };
    expect(body.data.online).toBe(true);
    expect(body.data.onlineFee).toBe(4440);
    // Rp25.000 untuk kedua tujuan (keputusan Owner 16 Okt 2026: pilihan Rp25.000 tetap ada untuk driver).
    expect(body.data.minimum).toEqual({ WALLET: 25000, PPOB: 25000 });
  });

  it("options carry the cash-commission percent only for drivers and only while the commission is on", async () => {
    const driver = await createDriverUser("ONL000021");
    const passenger = await createUser("ONL000022");
    const read = async (user: User) =>
      ((await (await api("/api/v1/web/wallet/topup/options?amount=25000&target=WALLET", { token: tokenFor(user, "WEB") })).json()) as {
        data: { commissionPercent: number | null };
      }).data.commissionPercent;
    const saved = { enabled: backendEnv.DRIVER_COMMISSION_ENABLED, percent: backendEnv.DRIVER_COMMISSION_PERCENT, min: backendEnv.DRIVER_MIN_CASH_BALANCE };
    try {
      backendEnv.DRIVER_COMMISSION_ENABLED = true;
      backendEnv.DRIVER_COMMISSION_PERCENT = 8;
      expect(await read(driver)).toBe(8);
      expect(await read(passenger)).toBeNull();
      backendEnv.DRIVER_COMMISSION_ENABLED = false;
      expect(await read(driver)).toBeNull();

      // Saldo minimal untuk menerima pesanan tunai: hanya driver, hanya bila komisi menyala dan batasnya > 0.
      const readMin = async (user: User) =>
        ((await (await api("/api/v1/web/wallet/topup/options?amount=25000&target=WALLET", { token: tokenFor(user, "WEB") })).json()) as {
          data: { cashOrderMinBalance: number | null };
        }).data.cashOrderMinBalance;
      backendEnv.DRIVER_COMMISSION_ENABLED = true;
      backendEnv.DRIVER_MIN_CASH_BALANCE = 50_000;
      expect(await readMin(driver)).toBe(50_000);
      expect(await readMin(passenger)).toBeNull();
      backendEnv.DRIVER_MIN_CASH_BALANCE = 0;
      expect(await readMin(driver)).toBeNull();
      backendEnv.DRIVER_COMMISSION_ENABLED = false;
      backendEnv.DRIVER_MIN_CASH_BALANCE = 50_000;
      expect(await readMin(driver)).toBeNull();
    } finally {
      backendEnv.DRIVER_COMMISSION_ENABLED = saved.enabled;
      backendEnv.DRIVER_COMMISSION_PERCENT = saved.percent;
      backendEnv.DRIVER_MIN_CASH_BALANCE = saved.min;
    }
  });

  it("offers a quote per payment method: the driver (WALLET) and every PPOB top up pay at most the cap", async () => {
    const user = await createDriverUser("ONL000020");
    type Options = { data: { methods: Array<{ id: string }>; walletFeeCap: number; quotes: Array<{ method: string; fee: number; gross: number }> } };
    const read = async (query: string) => ((await (await api(`/api/v1/web/wallet/topup/options?${query}`, { token: tokenFor(user, "WEB") })).json()) as Options).data;

    const wallet = await read("amount=50000&target=WALLET");
    expect(wallet.methods.map((m) => m.id)).toEqual(["bank_transfer", "gopay", "qris"]); // dana belum diaktifkan
    expect(wallet.walletFeeCap).toBe(2500);
    expect(wallet.quotes).toEqual([
      { method: "bank_transfer", fee: 2500, gross: 52500 },
      { method: "gopay", fee: 1021, gross: 51021 },
      { method: "qris", fee: 353, gross: 50353 }
    ]);

    const ppob = await read("amount=50000&target=PPOB");
    expect((ppob as unknown as { ppobFeeCap: number }).ppobFeeCap).toBe(2500);
    expect(ppob.quotes).toEqual([
      { method: "bank_transfer", fee: 2500, gross: 52500 },
      { method: "gopay", fee: 1021, gross: 51021 },
      { method: "qris", fee: 353, gross: 50353 }
    ]);

    // Tanpa nominal: tidak ada penawaran harga. Nominal tak sah ditolak.
    expect((await read("")).quotes).toBeUndefined();
    expect((await api("/api/v1/web/wallet/topup/options?amount=abc", { token: tokenFor(user, "WEB") })).status).toBe(400);
  });

  it("charges the driver the capped fee on a bank transfer: Snap is limited to the bank codes and the fee line sums to the total", async () => {
    const user = await createDriverUser("ONL000021");
    const created = await createOnline(user, 50000, "WALLET", "WEB", "bank_transfer");
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { reference: string; method: string; feeAmount: number; grossAmount: number } };
    expect(body.data).toMatchObject({ method: "bank_transfer", feeAmount: 2500, grossAmount: 52500 });
    const request = snapRequests[0] as { transaction_details: { gross_amount: number }; enabled_payments: string[]; item_details: Array<{ price: number; quantity: number }> };
    expect(request.enabled_payments).toEqual(["bni_va", "bri_va", "cimb_va", "permata_va", "echannel"]);
    expect(request.transaction_details.gross_amount).toBe(52500);
    expect(request.item_details.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(52500);

    expect((await notify(body.data.reference, "52500.00", "bank_transfer")).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.balance)).toBe("50000.00"); // saldo bertambah sebesar nominal saja
    const order = await prisma.walletTopUpOrder.findFirstOrThrow({ where: { userId: user.id } });
    // Biaya Midtrans sebenarnya Rp4.440, driver membayar Rp2.500: perusahaan menanggung selisihnya (bukan ditanggung pelanggan penuh).
    expect(order.metadata).toMatchObject({ method: "bank_transfer", feeAmount: 2500, grossAmount: 52500, gatewayFeeEstimate: "4440.00", feeBorneByCustomer: false });
  });

  it("a percentage method charges only its real cost and restricts Snap to that method", async () => {
    const user = await createDriverUser("ONL000022");
    const created = await createOnline(user, 50000, "WALLET", "WEB", "gopay");
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { reference: string; feeAmount: number; grossAmount: number } };
    expect(body.data).toMatchObject({ feeAmount: 1021, grossAmount: 51021 });
    expect((snapRequests[0] as { enabled_payments: string[] }).enabled_payments).toEqual(["gopay"]);
    expect((await notify(body.data.reference, "51021.00", "gopay")).status).toBe(200);
    const order = await prisma.walletTopUpOrder.findFirstOrThrow({ where: { userId: user.id } });
    expect(order.metadata).toMatchObject({ method: "gopay", feeBorneByCustomer: true });
  });

  it("rejects a method that is not available or not recognised, before any order is created", async () => {
    const user = await createUser("ONL000023");
    const unavailable = await createOnline(user, 50000, "WALLET", "WEB", "dana"); // dana tidak ada di daftar aktif
    expect(unavailable.status).toBe(400);
    expect(((await unavailable.json()) as { code?: string }).code).toBe("WALLET_TOPUP_METHOD_UNAVAILABLE");
    expect((await createOnline(user, 50000, "WALLET", "WEB", "bitcoin")).status).toBe(400);
    expect(await prisma.walletTopUpOrder.count()).toBe(0);
    expect(snapRequests).toHaveLength(0);
  });

  it("a passenger (no driver profile) pays the full fee on the TapGo balance: the cap is only for drivers", async () => {
    // Top up penumpang dipakai membayar perjalanan digital yang hanya memberi perusahaan 8% dari tarif, jadi biaya penuh.
    const passenger = await createUser("ONL000026");
    const options = await api("/api/v1/web/wallet/topup/options?amount=50000&target=WALLET", { token: tokenFor(passenger, "WEB") });
    const body = (await options.json()) as { data: { walletFeeCap: number | null; quotes: Array<{ method: string; fee: number }> } };
    expect(body.data.walletFeeCap).toBeNull();
    expect(body.data.quotes).toEqual([
      { method: "bank_transfer", fee: 4440, gross: 54440 },
      { method: "gopay", fee: 1021, gross: 51021 },
      { method: "qris", fee: 353, gross: 50353 }
    ]);
    const created = await createOnline(passenger, 50000, "WALLET", "WEB", "bank_transfer");
    expect(((await created.json()) as { data: { feeAmount: number; grossAmount: number } }).data).toMatchObject({ feeAmount: 4440, grossAmount: 54440 });
    const order = await prisma.walletTopUpOrder.findFirstOrThrow({ where: { userId: passenger.id } });
    expect(order.metadata).toMatchObject({ feeAmount: 4440, feeBorneByCustomer: true });
  });

  it("by default only bank transfer is offered, even when other methods are active at Midtrans", async () => {
    const user = await createUser("ONL000025");
    backendEnv.WALLET_TOPUP_METHODS = "bank_transfer"; // bawaan produksi
    try {
      const options = await api("/api/v1/web/wallet/topup/options?amount=50000&target=WALLET", { token: tokenFor(user, "WEB") });
      const body = (await options.json()) as { data: { methods: Array<{ id: string }>; quotes: Array<{ method: string }> } };
      expect(body.data.methods.map((m) => m.id)).toEqual(["bank_transfer"]);
      expect(body.data.quotes.map((q) => q.method)).toEqual(["bank_transfer"]);
      // GoPay aktif di daftar Snap tetapi belum dinyalakan untuk top up: ditolak sebelum pesanan dibuat.
      const gopay = await createOnline(user, 50000, "WALLET", "WEB", "gopay");
      expect(gopay.status).toBe(400);
      expect(await prisma.walletTopUpOrder.count()).toBe(0);
      // Klien lama tanpa metode tetap berhasil dengan transfer bank.
      const legacy = await createOnline(user, 50000, "WALLET");
      expect(legacy.status).toBe(201);
      expect((snapRequests[0] as { enabled_payments: string[] }).enabled_payments).toEqual(["bni_va", "bri_va", "cimb_va", "permata_va", "echannel"]);
    } finally {
      backendEnv.WALLET_TOPUP_METHODS = "bank_transfer,gopay,qris,dana";
    }
  });

  it("accepts the Rp25.000 option for the TapGo balance", async () => {
    const user = await createDriverUser("ONL000024");
    const created = await createOnline(user, 25000, "WALLET", "WEB", "bank_transfer");
    expect(created.status).toBe(201);
    expect(((await created.json()) as { data: { grossAmount: number } }).data.grossAmount).toBe(27500);
  });

  it("hides the online option when top up is switched off", async () => {
    const user = await createUser("ONL000002");
    backendEnv.WALLET_TOPUP_ENABLED = false;
    try {
      const options = await api("/api/v1/web/wallet/topup/options", { token: tokenFor(user, "WEB") });
      expect(((await options.json()) as { data: { online: boolean } }).data.online).toBe(false);
      const created = await createOnline(user, 50000, "PPOB");
      expect(created.status).toBe(403);
    } finally {
      backendEnv.WALLET_TOPUP_ENABLED = true;
    }
  });

  it("charges amount plus fee at Midtrans, and credits only the amount once the exact total is settled", async () => {
    const user = await createUser("ONL000003");
    const created = await createOnline(user, 50000, "PPOB");
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      data: { id: string; reference: string; baseAmount: number; feeAmount: number; grossAmount: number; redirectUrl: string; target: string };
    };
    expect(body.data).toMatchObject({ baseAmount: 50000, feeAmount: 2500, grossAmount: 52500, target: "PPOB" });
    expect(body.data.redirectUrl).toContain("midtrans.com");

    // Midtrans ditagih nominal + biaya, dan rincian item menjumlah tepat ke total itu.
    const request = snapRequests[0] as {
      transaction_details: { gross_amount: number };
      item_details: Array<{ price: number; quantity: number }>;
    };
    expect(request.transaction_details.gross_amount).toBe(52500);
    expect(request.item_details.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(52500);

    const settled = await notify(body.data.reference, "52500.00");
    expect(settled.status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.ppobBalance)).toBe("50000.00");
    expect(decimalString(wallet.balance)).toBe("0.00");

    // Notifikasi ulang tidak menambah saldo.
    expect((await notify(body.data.reference, "52500.00")).status).toBe(200);
    const again = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(again.ppobBalance)).toBe("50000.00");
    const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, type: "TOPUP" } });
    expect(ledger).toHaveLength(1);
  });

  it("rejects a settlement for the base amount alone, because the fee was not paid", async () => {
    const user = await createDriverUser("ONL000004");
    const created = await createOnline(user, 100000, "WALLET");
    const body = (await created.json()) as { data: { reference: string } };

    const response = await notify(body.data.reference, "100000.00");
    expect(response.status).toBe(400);
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).toBeNull();
  });

  it("credits the TapGo balance for the WALLET target", async () => {
    const user = await createDriverUser("ONL000005");
    const created = await createOnline(user, 100000, "WALLET");
    const body = (await created.json()) as { data: { reference: string } };
    expect((await notify(body.data.reference, "102500.00")).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.balance)).toBe("100000.00");
    expect(decimalString(wallet.ppobBalance)).toBe("0.00");
  });

  it("enforces the minimum per balance, an integer amount, and the web channel", async () => {
    const user = await createUser("ONL000006");
    expect((await createOnline(user, 10000, "PPOB")).status).toBe(400);
    expect((await createOnline(user, 24999, "WALLET")).status).toBe(400);
    expect((await createOnline(user, 50000.5, "WALLET")).status).toBe(400);
    expect((await createOnline(user, 99999999, "WALLET")).status).toBe(400);
    expect((await createOnline(user, 50000, "WALLET", "APP")).status).toBe(403);
    expect(await prisma.walletTopUpOrder.count()).toBe(0);
    expect(snapRequests).toHaveLength(0);
  });

  it("closes the order when Midtrans cannot create the payment, so it does not use up the open-order limit", async () => {
    const user = await createUser("ONL000007");
    snapShouldFail = true;
    const created = await createOnline(user, 50000, "WALLET");
    expect(created.status).toBe(502);
    const orders = await prisma.walletTopUpOrder.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("FAILED");
  });

  it("allows at most three unpaid online orders", async () => {
    const user = await createUser("ONL000008");
    for (let i = 0; i < 3; i += 1) {
      expect((await createOnline(user, 50000, "WALLET")).status).toBe(201);
    }
    expect((await createOnline(user, 50000, "WALLET")).status).toBe(429);
  });

  it("shows the order summary only to its owner", async () => {
    const owner = await createUser("ONL000009");
    const stranger = await createUser("ONL000010");
    const created = await createOnline(owner, 50000, "PPOB");
    const body = (await created.json()) as { data: { id: string } };

    const own = await api(`/api/v1/web/wallet/topup/online/${body.data.id}`, { token: tokenFor(owner, "WEB") });
    expect(own.status).toBe(200);
    const summary = (await own.json()) as { data: { status: string; baseAmount: number; feeAmount: number; grossAmount: number; target: string } };
    expect(summary.data).toMatchObject({ status: "PENDING", baseAmount: 50000, feeAmount: 2500, grossAmount: 52500, target: "PPOB" });
    expect(summary.data).toMatchObject({ online: true });
    // Tautan lanjut bayar hanya untuk pemilik; token Snap mentah tidak ikut.
    expect((summary.data as unknown as { resumeUrl: string }).resumeUrl).toContain("midtrans.com");
    expect(JSON.stringify(summary)).not.toContain("snapToken");

    const other = await api(`/api/v1/web/wallet/topup/online/${body.data.id}`, { token: tokenFor(stranger, "WEB") });
    expect(other.status).toBe(403);
  });

  it("sends the return address to Snap when APP_URL is set", async () => {
    const user = await createUser("ONL000013");
    const original = backendEnv.APP_URL;
    backendEnv.APP_URL = "https://tapgolion.id";
    try {
      expect((await createOnline(user, 50000, "PPOB")).status).toBe(201);
    } finally {
      backendEnv.APP_URL = original;
    }
    expect((snapRequests[0] as { callbacks?: { finish: string } }).callbacks).toEqual({ finish: "https://tapgolion.id/topup/status/" });
  });

  it("adds the fee on the older create-then-pay route as well", async () => {
    const user = await createDriverUser("ONL000011");
    const created = await api("/api/v1/web/wallet/topup/orders", { method: "POST", token: tokenFor(user, "WEB"), body: { amount: 100000 } });
    const body = (await created.json()) as { data: { id: string; reference: string } };
    const paid = await api(`/api/v1/web/wallet/topup/orders/${body.data.id}/pay`, { method: "POST", token: tokenFor(user, "WEB") });
    expect(paid.status).toBe(200);
    expect((snapRequests[0] as { transaction_details: { gross_amount: number } }).transaction_details.gross_amount).toBe(102500);
    expect((await notify(body.data.reference, "100000.00")).status).toBe(400);
    expect((await notify(body.data.reference, "102500.00")).status).toBe(200);
  });

  it("records the customer fee and the real gateway fee, which the cost report relies on", async () => {
    const user = await createUser("ONL000012");
    const created = await createOnline(user, 50000, "PPOB");
    const body = (await created.json()) as { data: { reference: string } };
    await notify(body.data.reference, "52500.00", "bank_transfer");
    const order = await prisma.walletTopUpOrder.findFirstOrThrow({ where: { userId: user.id } });
    // Biaya pelanggan Rp2.500 dari biaya sebenarnya Rp4.440: sisanya ditanggung perusahaan dan harus terbaca laporan biaya.
    expect(order.metadata).toMatchObject({ feeBorneByCustomer: false, feeAmount: 2500, gatewayFeeEstimate: "4440.00", paymentType: "bank_transfer" });
  });
});

function notify(orderId: string, grossAmount: string, paymentType?: string) {
  const statusCode = "200";
  const signature = createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`).digest("hex");
  return api("/api/v1/payments/midtrans/notification", {
    method: "POST",
    body: {
      order_id: orderId,
      transaction_id: `txn-${orderId}`,
      transaction_status: "settlement",
      status_code: statusCode,
      gross_amount: grossAmount,
      currency: "IDR",
      ...(paymentType ? { payment_type: paymentType } : {}),
      signature_key: signature
    }
  });
}

function createOnline(user: User, amount: number, target: "WALLET" | "PPOB", channel: "APP" | "WEB" = "WEB", method?: string) {
  return api("/api/v1/web/wallet/topup/online", {
    method: "POST",
    token: tokenFor(user, channel),
    body: { amount, target, ...(method ? { method } : {}) }
  });
}

/** Akun dengan profil driver: top up Saldo TapGo-nya menjadi komisi, sehingga biaya dibatasi Rp2.500. */
async function createDriverUser(referralCode: string): Promise<User> {
  const user = await createUser(referralCode);
  await prisma.rideDriverProfile.create({ data: { userId: user.id, status: "ACTIVE", availability: "OFFLINE" } });
  return user;
}

async function createUser(referralCode: string): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role: "USER",
      membershipId: basic.id
    }
  });
}

function tokenFor(user: User, channel: "APP" | "WEB") {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}`, channel });
}

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  return realFetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}
