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
let baseUrl = "";
let signAccessToken: SignAccessToken;

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
        const parsed = JSON.parse(body) as { transaction_details?: { order_id?: string } };
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
    Object.assign(env, {
      MIDTRANS_SERVER_KEY: midtransServerKey,
      MIDTRANS_CLIENT_KEY: "SB-Mid-client-test-key",
      MIDTRANS_IS_PRODUCTION: false,
      MIDTRANS_SNAP_URL: `http://127.0.0.1:${snapAddress.port}/snap/v1/transactions`,
      DOKU_ENABLED: false,
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
}) {
  return api("/api/v1/payments/midtrans/notification", {
    method: "POST",
    body: {
      ...payload,
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
