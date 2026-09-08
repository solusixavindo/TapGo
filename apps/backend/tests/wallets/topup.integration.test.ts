import { createHash } from "node:crypto";
import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  decimalString,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string; channel?: "APP" | "WEB" }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalTopUpEnabledEnv: string | undefined;
let originalMidtransServerKeyEnv: string | undefined;
const TEST_MIDTRANS_SERVER_KEY = "test-midtrans-server-key-for-topup";

describe.skipIf(!runIntegration)("Wallet Top Up API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-topup-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-topup-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    originalTopUpEnabledEnv = process.env.WALLET_TOPUP_ENABLED;
    originalMidtransServerKeyEnv = process.env.MIDTRANS_SERVER_KEY;
    process.env.WALLET_TOPUP_ENABLED = "true";
    process.env.MIDTRANS_SERVER_KEY = TEST_MIDTRANS_SERVER_KEY;

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    backendEnv.WALLET_TOPUP_ENABLED = true;
    backendEnv.MIDTRANS_SERVER_KEY = TEST_MIDTRANS_SERVER_KEY;
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    if (backendEnv) {
      backendEnv.WALLET_TOPUP_ENABLED = originalTopUpEnabledEnv?.trim().toLowerCase() === "true";
      backendEnv.MIDTRANS_SERVER_KEY = originalMidtransServerKeyEnv;
    }
    if (originalTopUpEnabledEnv == null) delete process.env.WALLET_TOPUP_ENABLED; else process.env.WALLET_TOPUP_ENABLED = originalTopUpEnabledEnv;
    if (originalMidtransServerKeyEnv == null) delete process.env.MIDTRANS_SERVER_KEY; else process.env.MIDTRANS_SERVER_KEY = originalMidtransServerKeyEnv;
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects top up order creation from an APP-channel token", async () => {
    const user = await createUser("TOPAPP001", "USER");
    const response = await createOrder(user, 100000, "APP");
    expect(response.status).toBe(403);
  });

  it("creates a pending order on a WEB-channel token and blocks paying someone else's order", async () => {
    const user = await createUser("TOPWEB001", "USER");
    const stranger = await createUser("TOPWEB002", "USER");

    const created = await createOrder(user, 150000, "WEB");
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string; reference: string; status: string } };
    expect(body.data.status).toBe("PENDING");

    const strangerPay = await api(`/api/v1/web/wallet/topup/orders/${body.data.id}/pay`, {
      method: "POST",
      token: tokenFor(stranger, "WEB")
    });
    expect(strangerPay.status).toBe(403);
  });

  it("credits the wallet exactly once when the Midtrans webhook confirms settlement, and ignores a replayed callback", async () => {
    const user = await createUser("TOPWEB003", "USER");
    const created = await createOrder(user, 200000, "WEB");
    const body = (await created.json()) as { data: { id: string; reference: string } };

    const payload = midtransSettlementPayload(body.data.reference, "200000.00");
    const first = await api("/api/v1/payments/midtrans/notification", { method: "POST", body: payload });
    expect(first.status).toBe(200);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.balance)).toBe("200000.00");
    const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, type: "TOPUP" } });
    expect(ledger).toHaveLength(1);

    // Webhook Midtrans dapat mengirim notifikasi yang sama lebih dari sekali —
    // replay TIDAK boleh mengkredit saldo kedua kalinya.
    const second = await api("/api/v1/payments/midtrans/notification", { method: "POST", body: payload });
    expect(second.status).toBe(200);
    const walletAfterReplay = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(walletAfterReplay.balance)).toBe("200000.00");
    const ledgerAfterReplay = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, type: "TOPUP" } });
    expect(ledgerAfterReplay).toHaveLength(1);
  });

  it("rejects a Midtrans callback whose amount does not match the authoritative order amount", async () => {
    const user = await createUser("TOPWEB004", "USER");
    const created = await createOrder(user, 200000, "WEB");
    const body = (await created.json()) as { data: { reference: string } };

    const tampered = midtransSettlementPayload(body.data.reference, "1.00");
    const response = await api("/api/v1/payments/midtrans/notification", { method: "POST", body: tampered });
    expect(response.status).toBe(400);

    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).toBeNull();
  });

  it("rejects a Midtrans callback with an invalid signature", async () => {
    const user = await createUser("TOPWEB005", "USER");
    const created = await createOrder(user, 200000, "WEB");
    const body = (await created.json()) as { data: { reference: string } };

    const payload = midtransSettlementPayload(body.data.reference, "200000.00");
    payload.signature_key = "not-the-real-signature";
    const response = await api("/api/v1/payments/midtrans/notification", { method: "POST", body: payload });
    expect(response.status).toBe(401);

    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    expect(wallet).toBeNull();
  });
});

function midtransSettlementPayload(orderId: string, grossAmount: string) {
  const statusCode = "200";
  const signature = createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${TEST_MIDTRANS_SERVER_KEY}`)
    .digest("hex");
  return {
    order_id: orderId,
    transaction_id: `txn-${orderId}`,
    transaction_status: "settlement",
    status_code: statusCode,
    gross_amount: grossAmount,
    currency: "IDR",
    signature_key: signature
  };
}

function createOrder(user: User, amount: number, channel: "APP" | "WEB") {
  return api("/api/v1/web/wallet/topup/orders", {
    method: "POST",
    token: tokenFor(user, channel),
    body: { amount }
  });
}

async function createUser(referralCode: string, role: UserRole): Promise<User> {
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

function tokenFor(user: User, channel: "APP" | "WEB") {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
    channel
  });
}

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
