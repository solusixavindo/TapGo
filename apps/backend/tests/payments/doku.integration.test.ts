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
let backendEnv: typeof import("../../src/config/env.js").env;
let originalExternalPaymentGateEnv: string | undefined;
let originalDokuEnabledEnv: string | undefined;

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
    originalExternalPaymentGateEnv =
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    originalDokuEnabledEnv = process.env.DOKU_ENABLED;
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "true";
    process.env.MEMBERSHIP_PURCHASE_APP_ENABLED = "true";
    process.env.DOKU_ENABLED = "true";
    process.env.DOKU_INTEGRATION_MODE = "checkout";
    process.env.DOKU_CLIENT_ID = dokuClientId;
    process.env.DOKU_SECRET_KEY = dokuSecretKey;
    process.env.DOKU_ENVIRONMENT = "sandbox";
    process.env.DOKU_BASE_URL = "https://api-sandbox.doku.com";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
    ]);
    backendEnv = envModule.env;
    // Stage R2.6 memisahkan kanal pembelian. Test ini menguji perilaku
    // distribusi direct, di mana pembelian dari dalam aplikasi diizinkan.
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = true;
    backendEnv.DOKU_ENABLED = true;
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
    if (backendEnv) {
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv?.trim().toLowerCase() === "true";
      backendEnv.DOKU_ENABLED =
        originalDokuEnabledEnv?.trim().toLowerCase() === "true";
    }
    if (originalExternalPaymentGateEnv == null) {
      delete process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    } else {
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv;
    }
    if (originalDokuEnabledEnv == null) {
      delete process.env.DOKU_ENABLED;
    } else {
      process.env.DOKU_ENABLED = originalDokuEnabledEnv;
    }
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
    const realFetch = globalThis.fetch;
    const dokuCheckoutUrl = "https://api-sandbox.doku.com/checkout/v1/payment";
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl !== dokuCheckoutUrl) {
        return realFetch(url, init);
      }
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
    const body = (await failedAfterPaid.json()) as {
      data: { status: string; idempotent: boolean };
    };
    expect(body.data.status).toBe("PAID");
    expect(body.data.idempotent).toBe(true);
    await expectPaidOrder(order.id, user.id, "SILVER");
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 1);
  });

  it("unknown webhook status does not activate membership", async () => {
    const user = await createApiUser("DOKU004");
    const order = await createOrderFor(user, "SILVER");

    const unknown = await postDokuWebhook(order.invoiceNumber, "REVIEW_REQUIRED");

    expect(unknown.status).toBe(200);
    const body = (await unknown.json()) as { data: { status: string } };
    expect(body.data.status).toBe("UNKNOWN");
    await expectPendingOrder(order.id, {
      provider: "DOKU",
      providerReference: `doku-${order.invoiceNumber}`,
    });
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 0);
  });

  it("invalid webhook signature is rejected", async () => {
    const user = await createApiUser("DOKU005");
    const order = await createOrderFor(user, "SILVER");

    const invalid = await postDokuWebhook(order.invoiceNumber, "SUCCESS", {
      signature: "HMACSHA256=invalid-signature",
    });

    expect(invalid.status).toBe(401);
    const body = (await invalid.json()) as { code: string };
    expect(body.code).toBe("DOKU_SIGNATURE_INVALID");
    await expectPendingOrder(order.id, { provider: null, providerReference: null });
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 0);
  });

  it("missing webhook signature headers are rejected", async () => {
    const user = await createApiUser("DOKU006");
    const order = await createOrderFor(user, "SILVER");

    const missingHeaders = await postDokuWebhook(order.invoiceNumber, "SUCCESS", {
      omitSignatureHeaders: true,
    });

    expect(missingHeaders.status).toBe(401);
    const body = (await missingHeaders.json()) as { code: string };
    expect(body.code).toBe("DOKU_SIGNATURE_INVALID");
    await expectPendingOrder(order.id, { provider: null, providerReference: null });
    await expectWalletTransactionCount(user.id, "PPOB_BENEFIT", 0);
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

async function postDokuWebhook(
  invoiceNumber: string,
  status: string,
  options: {
    signature?: string;
    omitSignatureHeaders?: boolean;
  } = {},
) {
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
    headers: options.omitSignatureHeaders
      ? {}
      : {
          "Client-Id": dokuClientId,
          "Request-Id": signed.requestId,
          "Request-Timestamp": signed.requestTimestamp,
          Signature: options.signature ?? signed.signature,
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

async function expectPendingOrder(
  orderId: string,
  options: {
    provider?: "DOKU" | null;
    providerReference?: string | null;
  } = {},
) {
  const order = await prisma.membershipOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      invoice: true,
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  expect(order.status).toBe("PENDING");
  expect(order.invoice?.status).toBe("PENDING");
  expect(order.payments[0]?.provider).toBe(
    Object.prototype.hasOwnProperty.call(options, "provider")
      ? options.provider
      : "DOKU",
  );
  expect(order.payments[0]?.providerReference).toBe(
    Object.prototype.hasOwnProperty.call(options, "providerReference")
      ? options.providerReference
      : order.invoice?.number,
  );
}

async function expectWalletTransactionCount(
  userId: string,
  type: "PPOB_BENEFIT",
  count: number,
) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    expect(count).toBe(0);
    return;
  }
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
