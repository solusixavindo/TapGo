import { MembershipTier, User, UserRole } from "@prisma/client";
import crypto, { randomUUID } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";
import { GooglePlayVerifier, GooglePlayVerifiedProductPurchase } from "../../src/modules/google-play/application/GooglePlayVerifier.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

const PACKAGE_NAME = "id.tapgolion.tapgo";
const PRODUCT_IDS = {
  SILVER: "tapgo_membership_silver",
  GOLD: "tapgo_membership_gold",
  PLATINUM: "tapgo_membership_platinum",
} as const satisfies Record<Exclude<MembershipTier, "BASIC">, string>;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let fakeVerifier: FakeGooglePlayVerifier;
let resetGooglePlayVerifierFactoryForTests: (() => void) | undefined;

describe.skipIf(!runIntegration)("Google Play purchase verification foundation", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-google-play-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-google-play-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    process.env.GOOGLE_PLAY_PACKAGE_NAME = PACKAGE_NAME;
    process.env.GOOGLE_PLAY_PURCHASE_TOKEN_ENCRYPTION_KEY = crypto
      .createHash("sha256")
      .update("tapgo-google-play-test-token-protection")
      .digest("base64");

    const [{ createApp }, tokenService, routes] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/modules/google-play/presentation/google-play.routes.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;
    fakeVerifier = new FakeGooglePlayVerifier();
    routes.setGooglePlayVerifierFactoryForTests(() => fakeVerifier);
    resetGooglePlayVerifierFactoryForTests = routes.resetGooglePlayVerifierFactoryForTests;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    fakeVerifier.reset();
    await seedGooglePlayProducts();
  });

  afterAll(async () => {
    resetGooglePlayVerifierFactoryForTests?.();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("activates Silver entitlement for a verified purchase without wallet, order, invoice, revenue, or bonus side effects", async () => {
    const user = await createApiUser("GPSILVER1");
    await prisma.wallet.create({ data: { userId: user.id } });
    fakeVerifier.setPurchased("token-silver-1", PRODUCT_IDS.SILVER);

    const response = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-silver-1");
    const body = await response.json() as { data: { membershipTier: string; entitlementStatus: string; acknowledgementState: string } };

    expect(response.status).toBe(200);
    expect(body.data.membershipTier).toBe("SILVER");
    expect(body.data.entitlementStatus).toBe("ACTIVE");
    expect(body.data.acknowledgementState).toBe("ACKNOWLEDGED");
    await expectActivePackage(user.id, "SILVER");
    await expectNoFinancialSideEffects(user.id);
    expect(fakeVerifier.acknowledgeCalls).toHaveLength(1);
  });

  it("is idempotent when the same user retries the same purchase token", async () => {
    const user = await createApiUser("GPRETRY1");
    fakeVerifier.setPurchased("token-retry-1", PRODUCT_IDS.SILVER);

    const first = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-retry-1");
    const second = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-retry-1");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.googlePlayPurchase.count()).toBe(1);
    expect(await prisma.userMembership.count({ where: { userId: user.id, status: "ACTIVE" } })).toBe(1);
    expect(fakeVerifier.verifyCalls).toHaveLength(1);
  });

  it("rejects the same purchase token for another user", async () => {
    const owner = await createApiUser("GPOWNER1");
    const other = await createApiUser("GPOTHER1");
    fakeVerifier.setPurchased("token-owned-1", PRODUCT_IDS.GOLD);

    expect((await verifyPurchase(owner, PRODUCT_IDS.GOLD, "token-owned-1")).status).toBe(200);
    const response = await verifyPurchase(other, PRODUCT_IDS.GOLD, "token-owned-1");
    const body = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("GOOGLE_PLAY_PURCHASE_TOKEN_OWNED_BY_ANOTHER_USER");
  });

  it("rejects product and package mismatches from Google verification", async () => {
    const user = await createApiUser("GPMISMAT");
    fakeVerifier.setPurchased("token-product-mismatch", PRODUCT_IDS.GOLD, { productId: PRODUCT_IDS.PLATINUM });
    fakeVerifier.setPurchased("token-package-mismatch", PRODUCT_IDS.GOLD, { packageName: "id.other.app" });

    const productMismatch = await verifyPurchase(user, PRODUCT_IDS.GOLD, "token-product-mismatch");
    const packageMismatch = await verifyPurchase(user, PRODUCT_IDS.GOLD, "token-package-mismatch");
    const productBody = await productMismatch.json() as { code: string };
    const packageBody = await packageMismatch.json() as { code: string };

    expect(productMismatch.status).toBe(400);
    expect(productBody.code).toBe("GOOGLE_PLAY_PRODUCT_MISMATCH");
    expect(packageMismatch.status).toBe(400);
    expect(packageBody.code).toBe("GOOGLE_PLAY_PACKAGE_MISMATCH");
    expect(await prisma.googlePlayPurchase.count()).toBe(0);
    await expectActivePackage(user.id, "BASIC");
  });

  it("records pending and cancelled purchases without activating membership", async () => {
    const pendingUser = await createApiUser("GPPEND");
    const cancelledUser = await createApiUser("GPCANCEL");
    fakeVerifier.setState("token-pending", PRODUCT_IDS.SILVER, "PENDING", "PENDING");
    fakeVerifier.setState("token-cancelled", PRODUCT_IDS.GOLD, "CANCELLED", "NOT_REQUIRED");

    const pending = await verifyPurchase(pendingUser, PRODUCT_IDS.SILVER, "token-pending");
    const cancelled = await verifyPurchase(cancelledUser, PRODUCT_IDS.GOLD, "token-cancelled");

    expect(pending.status).toBe(200);
    expect(cancelled.status).toBe(200);
    await expectActivePackage(pendingUser.id, "BASIC");
    await expectActivePackage(cancelledUser.id, "BASIC");
    expect(await prisma.googlePlayPurchase.count({ where: { entitlementStatus: "PENDING" } })).toBe(1);
    expect(await prisma.googlePlayPurchase.count({ where: { entitlementStatus: "CANCELLED" } })).toBe(1);
  });

  it("activates a previously pending purchase when Google later verifies it as purchased", async () => {
    const user = await createApiUser("GPPENDOK");
    fakeVerifier.setState("token-pending-to-purchased", PRODUCT_IDS.SILVER, "PENDING", "PENDING");

    const pending = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-pending-to-purchased");
    expect(pending.status).toBe(200);
    await expectActivePackage(user.id, "BASIC");

    fakeVerifier.setPurchased("token-pending-to-purchased", PRODUCT_IDS.SILVER);
    const purchased = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-pending-to-purchased");
    const body = await purchased.json() as { data: { entitlementStatus: string; membershipTier: string } };

    expect(purchased.status).toBe(200);
    expect(body.data.entitlementStatus).toBe("ACTIVE");
    expect(body.data.membershipTier).toBe("SILVER");
    await expectActivePackage(user.id, "SILVER");
    expect(await prisma.googlePlayPurchase.count()).toBe(1);
  });

  it("fails closed for unknown products, inactive products, verifier outage, and missing token protection", async () => {
    const user = await createApiUser("GPFAILS");

    const unknown = await verifyPurchase(user, "tapgo_membership_unknown", "token-unknown");
    expect(unknown.status).toBe(404);

    await prisma.googlePlayProduct.update({
      where: { productId: PRODUCT_IDS.SILVER },
      data: { isActive: false },
    });
    const inactive = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-inactive");
    expect(inactive.status).toBe(404);

    await prisma.googlePlayProduct.update({
      where: { productId: PRODUCT_IDS.SILVER },
      data: { isActive: true },
    });
    fakeVerifier.failVerification = true;
    const outage = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-outage");
    const outageBody = await outage.json() as { code: string };
    expect(outage.status).toBe(503);
    expect(outageBody.code).toBe("GOOGLE_PLAY_VERIFIER_UNAVAILABLE");
    fakeVerifier.failVerification = false;

    const { env } = await import("../../src/config/env.js");
    const originalKey = env.GOOGLE_PLAY_PURCHASE_TOKEN_ENCRYPTION_KEY;
    env.GOOGLE_PLAY_PURCHASE_TOKEN_ENCRYPTION_KEY = undefined;
    const missingProtection = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-missing-key");
    const missingProtectionBody = await missingProtection.json() as { code: string };
    expect(missingProtection.status).toBe(503);
    expect(missingProtectionBody.code).toBe("GOOGLE_PLAY_TOKEN_PROTECTION_NOT_CONFIGURED");
    env.GOOGLE_PLAY_PURCHASE_TOKEN_ENCRYPTION_KEY = originalKey;

    await expectActivePackage(user.id, "BASIC");
    expect(await prisma.googlePlayPurchase.count()).toBe(0);
  });

  it("allows full-price upgrade and rejects downgrade without changing the active entitlement", async () => {
    const user = await createApiUser("GPUPDOWN");
    fakeVerifier.setPurchased("token-silver-up", PRODUCT_IDS.SILVER);
    fakeVerifier.setPurchased("token-gold-up", PRODUCT_IDS.GOLD);
    fakeVerifier.setPurchased("token-silver-down", PRODUCT_IDS.SILVER, { googleOrderId: "GPA.DOWNGRADE" });

    expect((await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-silver-up")).status).toBe(200);
    expect((await verifyPurchase(user, PRODUCT_IDS.GOLD, "token-gold-up")).status).toBe(200);
    await expectActivePackage(user.id, "GOLD");

    const downgrade = await verifyPurchase(user, PRODUCT_IDS.SILVER, "token-silver-down");
    const downgradeBody = await downgrade.json() as { code: string };
    expect(downgrade.status).toBe(409);
    expect(downgradeBody.code).toBe("GOOGLE_PLAY_MEMBERSHIP_DOWNGRADE_NOT_ALLOWED");
    await expectActivePackage(user.id, "GOLD");
  });

  it("restores Basic when all Play entitlements are refunded or revoked", async () => {
    const user = await createApiUser("GPREFUND");
    fakeVerifier.setPurchased("token-refund", PRODUCT_IDS.PLATINUM);
    expect((await verifyPurchase(user, PRODUCT_IDS.PLATINUM, "token-refund")).status).toBe(200);

    await prisma.googlePlayPurchase.updateMany({
      where: { userId: user.id },
      data: {
        entitlementStatus: "REFUNDED",
        refundedAt: new Date(),
      },
    });

    const { GooglePlayPurchaseService } = await import("../../src/modules/google-play/application/GooglePlayPurchaseService.js");
    const { GooglePlayTokenProtection } = await import("../../src/modules/google-play/application/GooglePlayTokenProtection.js");
    const service = new GooglePlayPurchaseService(
      prisma,
      fakeVerifier,
      GooglePlayTokenProtection.fromEnv(),
    );

    const entitlement = await service.resolveHighestValidEntitlement(user.id);
    expect(entitlement.tier).toBe("BASIC");
  });

  it("allows only one successful grant when two verification requests race for the same token", async () => {
    const user = await createApiUser("GPRACE");
    fakeVerifier.setPurchased("token-race", PRODUCT_IDS.SILVER);

    const results = await Promise.allSettled([
      verifyPurchase(user, PRODUCT_IDS.SILVER, "token-race"),
      verifyPurchase(user, PRODUCT_IDS.SILVER, "token-race"),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const statuses = await Promise.all(results.map(async (result) => {
      if (result.status === "rejected") return 500;
      return result.value.status;
    }));
    expect(statuses).toEqual([200, 200]);
    expect(await prisma.googlePlayPurchase.count()).toBe(1);
    expect(await prisma.userMembership.count({ where: { userId: user.id, status: "ACTIVE" } })).toBe(1);
  });

  it("requires authentication and rejects client attempts to submit package name or status", async () => {
    const user = await createApiUser("GPSTRICT");

    const unauthenticated = await api("/api/v1/google-play/purchases/verify", {
      method: "POST",
      body: {
        productId: PRODUCT_IDS.SILVER,
        purchaseToken: "token-unauthenticated",
        clientRequestId: randomUUID(),
      },
    });
    expect(unauthenticated.status).toBe(401);

    const strict = await api("/api/v1/google-play/purchases/verify", {
      method: "POST",
      token: tokenFor(user),
      body: {
        productId: PRODUCT_IDS.SILVER,
        purchaseToken: "token-strict",
        clientRequestId: randomUUID(),
        packageName: PACKAGE_NAME,
        purchaseState: "PURCHASED",
        price: 500000,
      },
    });
    expect(strict.status).toBe(400);
  });
});

class FakeGooglePlayVerifier implements GooglePlayVerifier {
  verifyCalls: Array<{ packageName: string; productId: string }> = [];
  acknowledgeCalls: Array<{ packageName: string; productId: string }> = [];
  failVerification = false;

  private readonly purchases = new Map<string, GooglePlayVerifiedProductPurchase>();

  reset() {
    this.verifyCalls = [];
    this.acknowledgeCalls = [];
    this.failVerification = false;
    this.purchases.clear();
  }

  setPurchased(
    token: string,
    productId: string,
    overrides: Partial<GooglePlayVerifiedProductPurchase> = {},
  ) {
    this.setState(token, productId, "PURCHASED", "PENDING", overrides);
  }

  setState(
    token: string,
    productId: string,
    purchaseState: GooglePlayVerifiedProductPurchase["purchaseState"],
    acknowledgementState: GooglePlayVerifiedProductPurchase["acknowledgementState"],
    overrides: Partial<GooglePlayVerifiedProductPurchase> = {},
  ) {
    this.purchases.set(token, {
      packageName: PACKAGE_NAME,
      productId,
      purchaseState,
      acknowledgementState,
      googleOrderId: `GPA.${crypto.createHash("sha1").update(token).digest("hex").slice(0, 16)}`,
      purchaseTime: new Date("2026-07-22T00:00:00.000Z"),
      testPurchase: true,
      ...overrides,
    });
  }

  async verifyProductPurchase(input: { packageName: string; productId: string; purchaseToken: string }) {
    this.verifyCalls.push({
      packageName: input.packageName,
      productId: input.productId,
    });

    if (this.failVerification) {
      const { AppError } = await import("../../src/core/errors/AppError.js");
      throw new AppError(
        "Google Play verifier unavailable.",
        503,
        "GOOGLE_PLAY_VERIFIER_UNAVAILABLE",
      );
    }

    const purchase = this.purchases.get(input.purchaseToken);
    if (!purchase) {
      return {
        packageName: input.packageName,
        productId: input.productId,
        purchaseState: "UNKNOWN" as const,
        acknowledgementState: "NOT_REQUIRED" as const,
      };
    }

    return purchase;
  }

  async acknowledgeProductPurchase(input: { packageName: string; productId: string }) {
    this.acknowledgeCalls.push({
      packageName: input.packageName,
      productId: input.productId,
    });
    return { acknowledgedAt: new Date("2026-07-22T00:00:01.000Z") };
  }
}

async function seedGooglePlayProducts() {
  for (const [tier, productId] of Object.entries(PRODUCT_IDS) as Array<[Exclude<MembershipTier, "BASIC">, string]>) {
    const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
    await prisma.googlePlayProduct.create({
      data: {
        productId,
        packageName: PACKAGE_NAME,
        membershipId: membership.id,
      },
    });
  }
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
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function verifyPurchase(user: User, productId: string, purchaseToken: string) {
  return api("/api/v1/google-play/purchases/verify", {
    method: "POST",
    token: tokenFor(user),
    body: {
      productId,
      purchaseToken,
      clientRequestId: randomUUID(),
    },
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
      membershipId: basic.id,
    },
  });
}

async function expectActivePackage(userId: string, tier: MembershipTier) {
  const activeMemberships = await prisma.userMembership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { membership: true },
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: true },
  });

  if (tier === "BASIC") {
    expect(activeMemberships).toHaveLength(0);
  } else {
    expect(activeMemberships).toHaveLength(1);
    expect(activeMemberships[0]?.membership.tier).toBe(tier);
  }
  expect(user.membership?.tier).toBe(tier);
}

async function expectNoFinancialSideEffects(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  expect(wallet?.balance.toFixed(2)).toBe("0.00");
  expect(wallet?.cashBalance.toFixed(2)).toBe("0.00");
  expect(wallet?.ppobBalance.toFixed(2)).toBe("0.00");
  if (wallet) {
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id } })).toBe(0);
  }
  expect(await prisma.commission.count({ where: { OR: [{ beneficiaryId: userId }, { sourceUserId: userId }] } })).toBe(0);
  expect(await prisma.rewardTransaction.count({ where: { userId } })).toBe(0);
  expect(await prisma.membershipOrder.count({ where: { userId } })).toBe(0);
  expect(await prisma.invoice.count({ where: { userId } })).toBe(0);
  expect(await prisma.membershipPayment.count({ where: { userId } })).toBe(0);
  expect(await prisma.profitSharingDistribution.count({ where: { userId } })).toBe(0);
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: randomUUID(),
  });
}
