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
const saved = {
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
    expect(body.data.minimum.PPOB).toBeLessThan(body.data.minimum.WALLET);
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
    expect(body.data).toMatchObject({ baseAmount: 50000, feeAmount: 4440, grossAmount: 54440, target: "PPOB" });
    expect(body.data.redirectUrl).toContain("midtrans.com");

    // Midtrans ditagih nominal + biaya, dan rincian item menjumlah tepat ke total itu.
    const request = snapRequests[0] as {
      transaction_details: { gross_amount: number };
      item_details: Array<{ price: number; quantity: number }>;
    };
    expect(request.transaction_details.gross_amount).toBe(54440);
    expect(request.item_details.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(54440);

    const settled = await notify(body.data.reference, "54440.00");
    expect(settled.status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.ppobBalance)).toBe("50000.00");
    expect(decimalString(wallet.balance)).toBe("0.00");

    // Notifikasi ulang tidak menambah saldo.
    expect((await notify(body.data.reference, "54440.00")).status).toBe(200);
    const again = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(again.ppobBalance)).toBe("50000.00");
    const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, type: "TOPUP" } });
    expect(ledger).toHaveLength(1);
  });

  it("rejects a settlement for the base amount alone, because the fee was not paid", async () => {
    const user = await createUser("ONL000004");
    const created = await createOnline(user, 100000, "WALLET");
    const body = (await created.json()) as { data: { reference: string } };

    const response = await notify(body.data.reference, "100000.00");
    expect(response.status).toBe(400);
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).toBeNull();
  });

  it("credits the TapGo balance for the WALLET target", async () => {
    const user = await createUser("ONL000005");
    const created = await createOnline(user, 100000, "WALLET");
    const body = (await created.json()) as { data: { reference: string } };
    expect((await notify(body.data.reference, "104440.00")).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.balance)).toBe("100000.00");
    expect(decimalString(wallet.ppobBalance)).toBe("0.00");
  });

  it("enforces the minimum per balance, an integer amount, and the web channel", async () => {
    const user = await createUser("ONL000006");
    expect((await createOnline(user, 10000, "PPOB")).status).toBe(400);
    expect((await createOnline(user, 49999, "WALLET")).status).toBe(400);
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
    expect(summary.data).toMatchObject({ status: "PENDING", baseAmount: 50000, feeAmount: 4440, grossAmount: 54440, target: "PPOB" });
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
    const user = await createUser("ONL000011");
    const created = await api("/api/v1/web/wallet/topup/orders", { method: "POST", token: tokenFor(user, "WEB"), body: { amount: 100000 } });
    const body = (await created.json()) as { data: { id: string; reference: string } };
    const paid = await api(`/api/v1/web/wallet/topup/orders/${body.data.id}/pay`, { method: "POST", token: tokenFor(user, "WEB") });
    expect(paid.status).toBe(200);
    expect((snapRequests[0] as { transaction_details: { gross_amount: number } }).transaction_details.gross_amount).toBe(104440);
    expect((await notify(body.data.reference, "100000.00")).status).toBe(400);
    expect((await notify(body.data.reference, "104440.00")).status).toBe(200);
  });

  it("records that the customer paid the gateway fee, which the cost report relies on", async () => {
    const user = await createUser("ONL000012");
    const created = await createOnline(user, 50000, "PPOB");
    const body = (await created.json()) as { data: { reference: string } };
    await notify(body.data.reference, "54440.00", "bank_transfer");
    const order = await prisma.walletTopUpOrder.findFirstOrThrow({ where: { userId: user.id } });
    expect(order.metadata).toMatchObject({ feeBorneByCustomer: true, feeAmount: 4440, paymentType: "bank_transfer" });
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

function createOnline(user: User, amount: number, target: "WALLET" | "PPOB", channel: "APP" | "WEB" = "WEB") {
  return api("/api/v1/web/wallet/topup/online", {
    method: "POST",
    token: tokenFor(user, channel),
    body: { amount, target }
  });
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
