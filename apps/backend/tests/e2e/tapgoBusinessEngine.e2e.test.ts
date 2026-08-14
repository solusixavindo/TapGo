import { Prisma, User, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authRepository,
  cleanDatabase,
  decimalString,
  prisma,
  referralService,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalExternalPaymentGateEnv: string | undefined;

describe.skipIf(!runIntegration)("TapGo business engine E2E", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-e2e-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-e2e-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    originalExternalPaymentGateEnv =
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "true";
    process.env.MEMBERSHIP_PURCHASE_APP_ENABLED = "true";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    // Stage R2.6 memisahkan kanal pembelian. Test ini menguji perilaku
    // distribusi direct, di mana pembelian dari dalam aplikasi diizinkan.
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = true;
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
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv?.trim().toLowerCase() === "true";
    }
    if (originalExternalPaymentGateEnv == null) {
      delete process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    } else {
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv;
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("validates full membership, referral, wallet, commission, reward, and profit sharing flow", async () => {
    const admin = await registerUser("Admin TapGo", "080000000000", "SUPER_ADMIN");

    const userA = await registerUser("User A", "081000000001");
    await expectWalletPpobBalance(userA.id, "5000.00");

    const userB = await registerUser("User B", "081000000002");
    await claimReferral(userB.id, userA.referralCode, "scenario-2:b-uses-a");

    const bSilverOrder = await createMembershipOrder(userB, "SILVER");
    await payMembershipOrder(userB, bSilverOrder.id, "scenario-3:b-silver");

    await expectActiveMembership(userB.id, "SILVER");
    await expectWalletTransaction(userB.id, "PPOB_BENEFIT", "MEMBERSHIP_ORDER", bSilverOrder.id, "100000.00");
    await expectWalletTransaction(userA.id, "BASIC_SPONSOR_BONUS", "MEMBERSHIP_ORDER", bSilverOrder.id, "2000.00");
    await expectCommission(userA.id, "BASIC_SPONSOR_BONUS", "MEMBERSHIP_ORDER", bSilverOrder.id, "2000.00");

    const userC = await registerUser("User C", "081000000003");
    const userD = await registerUser("User D", "081000000004");
    const userE = await registerUser("User E", "081000000005");
    await claimReferral(userC.id, userB.referralCode, "scenario-4:c-uses-b");
    await claimReferral(userD.id, userB.referralCode, "scenario-4:d-uses-b");
    await claimReferral(userE.id, userB.referralCode, "scenario-4:e-uses-b");
    expect(await directSponsorCount(userB.id)).toBe(3);

    const eSilverOrder = await createMembershipOrder(userE, "SILVER");
    await payMembershipOrder(userE, eSilverOrder.id, "scenario-5:e-silver");
    await expectWalletTransaction(userB.id, "SPONSOR_BONUS", "MEMBERSHIP_ORDER", eSilverOrder.id, "40000.00");
    await expectWalletTransaction(userB.id, "LEVEL_BONUS", "MEMBERSHIP_ORDER", eSilverOrder.id, "40000.00");
    await expectCommission(userB.id, "LEVEL_BONUS", "MEMBERSHIP_ORDER", eSilverOrder.id, "40000.00", 1);

    const aPlatinumOrder = await createMembershipOrder(userA, "PLATINUM");
    await payMembershipOrder(userA, aPlatinumOrder.id, "scenario-6:a-platinum");
    await expectActiveMembership(userA.id, "PLATINUM");

    for (let index = 0; index < 9; index += 1) {
      const direct = await registerUser(`User A Direct ${index}`, `0810000001${index.toString().padStart(2, "0")}`);
      await claimReferral(direct.id, userA.referralCode, `scenario-7:a-direct-${index}`);
      const directSilverOrder = await createMembershipOrder(direct, "SILVER");
      await payMembershipOrder(direct, directSilverOrder.id, `scenario-7:a-direct-silver-${index}`);
    }
    expect(await directSponsorCount(userA.id)).toBe(10);
    const aRewardCheckOrder = await createMembershipOrder(userA, "PLATINUM");
    await payMembershipOrder(userA, aRewardCheckOrder.id, "scenario-7:a-reward-check");
    await expectRewardPending(userA.id, "DIRECT_SILVER_10", "500000.00");

    const profitPeriod = await createProfitSharingPeriod(admin, 5, 2026, 1000000);
    await approveProfitSharingPeriod(admin, profitPeriod.id);
    await distributeProfitSharingPeriod(admin, profitPeriod.id);

    const distributions = await prisma.profitSharingDistribution.findMany({
      where: { periodId: profitPeriod.id },
      orderBy: { createdAt: "asc" }
    });
    expect(distributions.length).toBeGreaterThanOrEqual(1);
    expect(distributions.every((item) => item.status === "POSTED")).toBe(true);

    const finalWallets = await walletSummary([userA, userB, userE]);
    const finalCommissions = await prisma.commission.groupBy({
      by: ["type"],
      _count: { _all: true },
      _sum: { amount: true }
    });
    const finalMemberships = await prisma.userMembership.findMany({
      where: { userId: { in: [userA.id, userB.id, userE.id] } },
      include: { membership: true },
      orderBy: { createdAt: "asc" }
    });

    expect(finalWallets.find((item) => item.userId === userA.id)?.balance).toBeDefined();
    expect(finalCommissions.find((item) => item.type === "SPONSOR_BONUS")?._count._all).toBeGreaterThanOrEqual(1);
    expect(finalCommissions.find((item) => item.type === "LEVEL_BONUS")?._count._all).toBeGreaterThanOrEqual(1);
    expect(await prisma.rewardTransaction.count({ where: { userId: userA.id, referenceId: "DIRECT_SILVER_10" } })).toBe(1);
    expect(finalCommissions.find((item) => item.type === "PROFIT_SHARING")?._count._all).toBe(distributions.length);
    expect(finalMemberships.some((item) => item.userId === userA.id && item.membership.tier === "PLATINUM" && item.status === "ACTIVE")).toBe(true);
    expect(finalMemberships.some((item) => item.userId === userB.id && item.membership.tier === "SILVER" && item.status === "ACTIVE")).toBe(true);
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

async function registerUser(fullName: string, phone: string, role: UserRole = "USER") {
  return authRepository.createUser({
    fullName,
    phone,
    passwordHash: "hashed-password",
    role,
    referralCode: fullName.replaceAll(" ", "").toUpperCase().slice(0, 12) + phone.slice(-4)
  });
}

async function claimReferral(userId: string, sponsorCode: string, triggerId: string) {
  await referralService.claimReferral({
    userId,
    sponsorCode,
    triggerType: "REFERRAL_JOIN",
    triggerId,
    baseAmount: new Prisma.Decimal(0)
  });
}

async function createMembershipOrder(user: User, tier: "SILVER" | "GOLD" | "PLATINUM") {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const response = await api("/api/v1/membership/orders", {
    method: "POST",
    token: tokenFor(user),
    body: { packageId: membership.id }
  });
  const body = await response.json() as { data: { id: string } };

  expect(response.status).toBe(201);
  return body.data;
}

async function payMembershipOrder(user: User, orderId: string, paymentReference: string) {
  const response = await api(`/api/v1/membership/orders/${orderId}/payment-success`, {
    method: "POST",
    token: tokenFor(user),
    body: { paymentReference }
  });

  expect(response.status).toBe(200);
  return response;
}

async function createProfitSharingPeriod(admin: User, periodMonth: number, periodYear: number, totalPoolAmount: number) {
  const response = await api("/api/v1/admin/profit-sharing/periods", {
    method: "POST",
    token: tokenFor(admin),
    body: { periodMonth, periodYear, totalPoolAmount }
  });
  const body = await response.json() as { data: { id: string } };

  expect(response.status).toBe(201);
  return body.data;
}

async function approveProfitSharingPeriod(admin: User, periodId: string) {
  const response = await api(`/api/v1/admin/profit-sharing/periods/${periodId}/approve`, {
    method: "POST",
    token: tokenFor(admin)
  });

  expect(response.status).toBe(200);
}

async function distributeProfitSharingPeriod(admin: User, periodId: string) {
  const response = await api(`/api/v1/admin/profit-sharing/periods/${periodId}/distribute`, {
    method: "POST",
    token: tokenFor(admin)
  });

  expect(response.status).toBe(200);
}

async function expectActiveMembership(userId: string, tier: "SILVER" | "GOLD" | "PLATINUM") {
  const active = await prisma.userMembership.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { membership: true }
  });

  expect(active?.membership.tier).toBe(tier);
}

async function expectWalletPpobBalance(userId: string, expectedBalance: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  expect(decimalString(wallet.ppobBalance)).toBe(expectedBalance);
}

async function expectRewardPending(userId: string, referenceId: string, expectedAmount: string) {
  const reward = await prisma.rewardTransaction.findUniqueOrThrow({
    where: {
      userId_referenceType_referenceId: {
        userId,
        referenceType: "REWARD_MILESTONE",
        referenceId
      }
    }
  });
  expect(reward.status).toBe("PENDING");
  expect(decimalString(reward.amount)).toBe(expectedAmount);
}

async function expectWalletTransaction(
  userId: string,
  type: "PPOB_BENEFIT" | "BASIC_SPONSOR_BONUS" | "SPONSOR_BONUS" | "LEVEL_BONUS" | "REWARD_BONUS" | "PROFIT_SHARING",
  referenceType: string,
  referenceId: string,
  expectedAmount: string
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, type, referenceType, referenceId }
  });

  expect(transactions).toHaveLength(1);
  expect(decimalString(transactions[0]!.amount)).toBe(expectedAmount);
}

async function expectCommission(
  userId: string,
  type: "BASIC_SPONSOR_BONUS" | "SPONSOR_BONUS" | "LEVEL_BONUS" | "REWARD_BONUS" | "PROFIT_SHARING",
  triggerType: string,
  triggerId: string,
  expectedAmount: string,
  level = 1
) {
  const commissions = await prisma.commission.findMany({
    where: { beneficiaryId: userId, type, triggerType, triggerId, level }
  });

  expect(commissions).toHaveLength(1);
  expect(decimalString(commissions[0]!.amount)).toBe(expectedAmount);
}

async function directSponsorCount(userId: string) {
  return prisma.referral.count({
    where: { sponsorId: userId, status: "ACTIVE" }
  });
}

async function walletSummary(users: User[]) {
  return Promise.all(users.map(async (user) => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    return {
      userId: user.id,
      name: user.fullName,
      balance: decimalString(wallet.balance)
    };
  }));
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: randomUUID()
  });
}
