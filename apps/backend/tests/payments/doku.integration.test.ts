import { MembershipTier, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signDokuRequest } from "../../src/lib/doku/signature.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const dokuClientId = "BRN-TEST-DOKU";
const dokuSecretKey = "doku-test-secret";
let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;

describe.skipIf(!runIntegration)("DOKU checkout membership payments", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error(
        "TAPGO_TEST_DATABASE_URL must point to a dedicated test database.",
      );
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ??
      "test-access-secret-for-tapgo-doku-api";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ??
      "test-refresh-secret-for-tapgo-doku-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS =
      process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    process.env.DOKU_ENABLED = "true";
    process.env.DOKU_INTEGRATION_MODE = "checkout";
    process.env.DOKU_CLIENT_ID = dokuClientId;
    process.env.DOKU_SECRET_KEY = dokuSecretKey;
    process.env.DOKU_ENVIRONMENT = "sandbox";
    process.env.DOKU_BASE_URL = "https://api-sandbox.doku.com";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) =>
      appServer!.listen(0, "127.0.0.1", resolve),
    );
    const appAddress = appServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${appAddress.port}`;
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
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
  });

  it("paid webhook activates membership once and duplicate paid webhook is idempotent", async () => {
    const user = await createApiUser("DOKU001");
    const order = await createOrderFor(user, "SILVER");

    const first = await postDokuWebhook(order.invoiceNumber, "SUCCESS");
    const duplicate = await postDokuWebhook(order.invoiceNumber, "SUCCESS");

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
  });

  it("creates Silver DOKU checkout payment, keeps invoice pending, then paid webhook activates membership once", async () => {
    const user = await createApiUser("DOKU003");
    const sponsor = await createApiUser("DOKUSPONSOR");
    await prisma.referral.create({
      data: {
        sponsorId: sponsor.id,
        userId: user.id,
        status: "ACTIVE",
        metadata: { source: "doku-uat-test" },
      },
    });
    const order = await createOrderFor(user, "SILVER");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api-sandbox.doku.com/checkout/v1/payment");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        order?: { amount?: number; invoice_number?: string };
      };
      expect(body.order?.amount).toBe(500000);
      expect(body.order?.invoice_number).toBe(order.invoiceNumber);
      return new Response(
        JSON.stringify({
          response: {
            order: { invoice_number: order.invoiceNumber },
            payment: {
              url: `https://sandbox.doku.com/checkout/${order.invoiceNumber}`,
              expired_date: "2026-07-03T10:00:00Z",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const createPayment = await api("/api/v1/payments/doku/create", {
      method: "POST",
      token: tokenFor(user),
      body: { orderId: order.id },
    });
    const createPaymentBody = (await createPayment.json()) as {
      data: {
        paymentUrl: string;
        redirectUrl: string;
        referenceId: string;
        expiredAt: string;
      };
    };

    expect(createPayment.status).toBe(200);
    expect(createPaymentBody.data.paymentUrl).toBe(
      `https://sandbox.doku.com/checkout/${order.invoiceNumber}`,
    );
    expect(createPaymentBody.data.redirectUrl).toBe(
      createPaymentBody.data.paymentUrl,
    );
    expect(createPaymentBody.data.referenceId).toBe(order.invoiceNumber);
    expect(createPaymentBody.data.expiredAt).toBe("2026-07-03T10:00:00Z");
    await expectPendingOrder(order.id);

    const firstPaid = await postDokuWebhook(order.invoiceNumber, "SUCCESS");
    const duplicatePaid = await postDokuWebhook(order.invoiceNumber, "SUCCESS");

    expect(firstPaid.status).toBe(200);
    expect(duplicatePaid.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
    await expectSponsorBonusNotDuplicated(sponsor.id);
  });

  it("failed webhook after paid does not reverse paid membership", async () => {
    const user = await createApiUser("DOKU002");
    const order = await createOrderFor(user, "SILVER");

    await postDokuWebhook(order.invoiceNumber, "SUCCESS");
    const failedAfterPaid = await postDokuWebhook(order.invoiceNumber, "FAILED");

    expect(failedAfterPaid.status).toBe(200);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
  });
});

async function api(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function createApiUser(
  referralCode: string,
  role: UserRole = "USER",
): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({
    where: { tier: "BASIC" },
  });

  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id,
    },
  });
}

async function createOrderFor(user: User, tier: MembershipTier) {
  const membershipPackage = await prisma.membership.findUniqueOrThrow({
    where: { tier },
  });
  const response = await api("/api/v1/membership/orders", {
    method: "POST",
    token: tokenFor(user),
    body: { packageId: membershipPackage.id },
  });
  const body = (await response.json()) as {
    data: { id: string; invoice: { number: string } };
  };

  expect(response.status).toBe(201);
  return {
    id: body.data.id,
    invoiceNumber: body.data.invoice.number,
  };
}

async function postDokuWebhook(invoiceNumber: string, status: string) {
  const target = "/api/v1/webhooks/doku";
  const body = {
    order: { invoice_number: invoiceNumber, amount: "500000" },
    transaction: {
      status,
      original_request_id: `doku-${invoiceNumber}`,
    },
  };
  const signed = signDokuRequest({
    clientId: dokuClientId,
    secretKey: dokuSecretKey,
    requestTarget: target,
    requestId: `req-${invoiceNumber}-${status}`,
    requestTimestamp: "2026-07-01T10:00:00Z",
    body: JSON.stringify(body),
  });

  return api(target, {
    method: "POST",
    body,
    headers: {
      "Client-Id": dokuClientId,
      "Request-Id": signed.requestId,
      "Request-Timestamp": signed.requestTimestamp,
      Signature: signed.signature,
    },
  });
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
  });
}

async function expectPaidOrder(
  orderId: string,
  userId: string,
  tier: MembershipTier,
) {
  const order = await prisma.membershipOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      invoice: true,
      userMembership: { include: { membership: true } },
    },
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: true },
  });

  expect(order.status).toBe("PAID");
  expect(order.invoice?.status).toBe("PAID");
  expect(order.userMembership?.status).toBe("ACTIVE");
  expect(order.userMembership?.membership.tier).toBe(tier);
  expect(user.membership?.tier).toBe(tier);
}

async function expectPendingOrder(orderId: string) {
  const order = await prisma.membershipOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      invoice: true,
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  expect(order.status).toBe("PENDING");
  expect(order.invoice?.status).toBe("PENDING");
  expect(order.payments[0]?.provider).toBe("DOKU");
  expect(order.payments[0]?.providerReference).toBe(order.invoice?.number);
}

async function expectWalletTransactionCount(
  userId: string,
  type: "PPOB_BENEFIT",
  count: number,
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, type },
  });
  expect(transactions).toHaveLength(count);
}

async function expectSponsorBonusNotDuplicated(sponsorId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: sponsorId } });
  if (!wallet) {
    return;
  }
  const transactions = await prisma.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type: { in: ["SPONSOR_BONUS", "LEVEL_BONUS"] },
    },
  });
  expect(transactions.length).toBeLessThanOrEqual(1);
}
