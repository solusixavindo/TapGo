import { MembershipTier, User, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
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

describe.skipIf(!runIntegration)("Membership order API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-membership-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-membership-api";
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

  it("lists membership packages", async () => {
    const response = await api("/api/v1/membership/packages");
    const body = await response.json() as { data: Array<{ tier: MembershipTier; price: string }> };

    expect(response.status).toBe(200);
    expect(body.data.map((item) => item.tier)).toEqual(["BASIC", "SILVER", "GOLD", "PLATINUM"]);
    expect(body.data.find((item) => item.tier === "SILVER")?.price).toBe("500000");
  });

  it("creates a pending membership order with invoice and placeholder payment", async () => {
    const user = await createApiUser("ORDER001");
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

    const response = await api("/api/v1/membership/orders", {
      method: "POST",
      token: tokenFor(user),
      body: { packageId: silver.id, registrationData: { ktpNumber: "1234567890123456" } }
    });
    const body = await response.json() as {
      data: {
        status: string;
        totalAmount: string;
        invoice: { number: string; status: string; amount: string };
        payments: Array<{ status: string; method: string; amount: string }>;
      };
    };

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("PENDING");
    expect(body.data.totalAmount).toBe("500000");
    expect(body.data.invoice.number).toMatch(/^INV-MBR-\d{8}-/);
    expect(body.data.invoice.status).toBe("PENDING");
    expect(body.data.payments[0]?.status).toBe("PENDING");
    expect(body.data.payments[0]?.method).toBe("DEVELOPMENT_PLACEHOLDER");
  });

  it("returns order detail for the owner", async () => {
    const user = await createApiUser("OWNER001");
    const order = await createOrderFor(user, "GOLD");

    const response = await api(`/api/v1/membership/orders/${order.id}`, {
      token: tokenFor(user)
    });
    const body = await response.json() as { data: { id: string; membership: { tier: MembershipTier } } };

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(order.id);
    expect(body.data.membership.tier).toBe("GOLD");
  });

  it("blocks unauthenticated order access", async () => {
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

    const response = await api("/api/v1/membership/orders", {
      method: "POST",
      body: { packageId: silver.id }
    });

    expect(response.status).toBe(401);
  });

  it("blocks users from reading another user's order", async () => {
    const owner = await createApiUser("OWNER002");
    const other = await createApiUser("OTHER002");
    const order = await createOrderFor(owner, "PLATINUM");

    const response = await api(`/api/v1/membership/orders/${order.id}`, {
      token: tokenFor(other)
    });

    expect(response.status).toBe(403);
  });

  it("blocks duplicate pending orders for the same user", async () => {
    const user = await createApiUser("DUPORDER");
    await createOrderFor(user, "SILVER");
    const gold = await prisma.membership.findUniqueOrThrow({ where: { tier: "GOLD" } });

    const response = await api("/api/v1/membership/orders", {
      method: "POST",
      token: tokenFor(user),
      body: { packageId: gold.id }
    });
    const body = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("MEMBERSHIP_ORDER_PENDING");
  });

  it("falls back to Basic profile membership when user has no active paid membership order", async () => {
    const user = await createApiUser("EMPTY001");

    const response = await api("/api/v1/membership/me", {
      token: tokenFor(user)
    });
    const body = await response.json() as {
      data: {
        status: string;
        membership: {
          membership: { tier: string };
          metadata: { source: string };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.membership.membership.tier).toBe("BASIC");
    expect(body.data.membership.metadata.source).toBe("USER_PROFILE_MEMBERSHIP");
  });

  it("marks Silver payment as paid, activates membership, and credits PPOB once", async () => {
    const user = await createApiUser("SILVERPAY");
    const order = await createOrderFor(user, "SILVER");

    const response = await payOrder(user, order.id, "silver-payment");
    const body = await response.json() as { data: { status: string; invoice: { status: string }; userMembership: { status: string } } };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("PAID");
    expect(body.data.invoice.status).toBe("PAID");
    expect(body.data.userMembership.status).toBe("ACTIVE");

    await expectActivePackage(user.id, "SILVER");
    await expectWallet(user.id, "100000.00", 1);
  });

  it("upgrades Silver to Gold, closes old membership, and credits Gold PPOB once", async () => {
    const user = await createApiUser("GOLDPAY");
    const silverOrder = await createOrderFor(user, "SILVER");
    await payOrder(user, silverOrder.id, "silver-before-gold");

    const goldOrder = await createOrderFor(user, "GOLD");
    const response = await payOrder(user, goldOrder.id, "gold-payment");

    expect(response.status).toBe(200);
    await expectActivePackage(user.id, "GOLD");
    await expectMembershipStatusByOrder(silverOrder.id, "EXPIRED");
    await expectWallet(user.id, "700000.00", 2);
  });

  it("upgrades to Platinum and credits Platinum PPOB once", async () => {
    const user = await createApiUser("PLATPAY");
    const silverOrder = await createOrderFor(user, "SILVER");
    await payOrder(user, silverOrder.id, "silver-before-platinum");
    const goldOrder = await createOrderFor(user, "GOLD");
    await payOrder(user, goldOrder.id, "gold-before-platinum");

    const platinumOrder = await createOrderFor(user, "PLATINUM");
    const response = await payOrder(user, platinumOrder.id, "platinum-payment");

    expect(response.status).toBe(200);
    await expectActivePackage(user.id, "PLATINUM");
    await expectMembershipStatusByOrder(goldOrder.id, "EXPIRED");
    await expectWallet(user.id, "1700000.00", 3);
  });

  it("blocks paying an invoice twice and keeps PPOB ledger unchanged", async () => {
    const user = await createApiUser("DOUBLEPAY");
    const order = await createOrderFor(user, "SILVER");
    await payOrder(user, order.id, "first-payment");

    const response = await payOrder(user, order.id, "second-payment");
    const body = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("MEMBERSHIP_INVOICE_ALREADY_FINALIZED");
    await expectWallet(user.id, "100000.00", 1);
  });

  it("credits sponsor Rp40.000 when direct referral buys Silver", async () => {
    const sponsor = await createApiUser("SPONSILV");
    const buyer = await createApiUser("BUYSILV");
    await activateUserPackage(sponsor.id, "SILVER");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "silver-sponsor-payment");

    expect(response.status).toBe(200);
    await expectActivePackage(buyer.id, "SILVER");
    await expectSponsorBonus(sponsor.id, order.id, "40000.00", "SPONSOR_BONUS");
  });

  it("credits sponsor Rp240.000 when direct referral buys Gold", async () => {
    const sponsor = await createApiUser("SPONGOLD");
    const buyer = await createApiUser("BUYGOLD");
    await activateUserPackage(sponsor.id, "GOLD");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "GOLD");
    const response = await payOrder(buyer, order.id, "gold-sponsor-payment");

    expect(response.status).toBe(200);
    await expectSponsorBonus(sponsor.id, order.id, "240000.00", "SPONSOR_BONUS");
  });

  it("credits sponsor Rp440.000 when direct referral buys Platinum", async () => {
    const sponsor = await createApiUser("SPONPLAT");
    const buyer = await createApiUser("BUYPLAT");
    await activateUserPackage(sponsor.id, "PLATINUM");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "PLATINUM");
    const response = await payOrder(buyer, order.id, "platinum-sponsor-payment");

    expect(response.status).toBe(200);
    await expectSponsorBonus(sponsor.id, order.id, "440000.00", "SPONSOR_BONUS");
  });

  it("does not duplicate sponsor bonus when payment success is called twice", async () => {
    const sponsor = await createApiUser("SPONDUP");
    const buyer = await createApiUser("BUYDUP");
    await activateUserPackage(sponsor.id, "SILVER");
    await createDirectReferral(sponsor.id, buyer.id);
    const order = await createOrderFor(buyer, "SILVER");

    await payOrder(buyer, order.id, "first-sponsor-payment");
    const duplicate = await payOrder(buyer, order.id, "second-sponsor-payment");

    expect(duplicate.status).toBe(409);
    await expectSponsorBonus(sponsor.id, order.id, "40000.00", "SPONSOR_BONUS");
  });

  it("activates membership without sponsor bonus when user has no sponsor", async () => {
    const buyer = await createApiUser("NOSPONS");
    const order = await createOrderFor(buyer, "SILVER");

    const response = await payOrder(buyer, order.id, "no-sponsor-payment");

    expect(response.status).toBe(200);
    await expectActivePackage(buyer.id, "SILVER");
    expect(await prisma.commission.count({ where: { sourceUserId: buyer.id, type: "SPONSOR_BONUS" } })).toBe(0);
  });

  it("credits Basic sponsor bonus Rp2.000 when direct referral buys a paid package", async () => {
    const sponsor = await createApiUser("SPONBASIC");
    const buyer = await createApiUser("BUYBASIC");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "basic-sponsor-payment");

    expect(response.status).toBe(200);
    await expectSponsorBonus(sponsor.id, order.id, "2000.00", "BASIC_SPONSOR_BONUS");
  });

  it("does not credit sponsor bonus for Basic package orders", async () => {
    const sponsor = await createApiUser("SPONBPKG");
    const buyer = await createApiUser("BUYBPKG");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "BASIC");
    const response = await payOrder(buyer, order.id, "basic-package-payment");

    expect(response.status).toBe(200);
    expect(await prisma.commission.count({
      where: {
        beneficiaryId: sponsor.id,
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: order.id
      }
    })).toBe(0);
  });

  it("credits level 1 bonus 8% for Silver upline without direct sponsor unlocks", async () => {
    const sponsor = await createApiUser("LVL1SPON");
    const buyer = await createApiUser("LVL1BUY");
    await activateUserPackage(sponsor.id, "SILVER");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "level-1-payment");

    expect(response.status).toBe(200);
    await expectLevelBonus(sponsor.id, order.id, 1, "40000.00", "8.00");
  });

  it("credits level 2 bonus 4% for Silver upline", async () => {
    const level2 = await createApiUser("LVL2TOP");
    const level1 = await createApiUser("LVL2MID");
    const buyer = await createApiUser("LVL2BUY");
    await activateUserPackage(level2.id, "SILVER");
    await createUplineChain(buyer, [level1, level2]);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "level-2-payment");

    expect(response.status).toBe(200);
    await expectLevelBonus(level2.id, order.id, 2, "20000.00", "4.00");
  });

  it("credits level 3 bonus 2% for Silver upline", async () => {
    const level3 = await createApiUser("LVL3TOP");
    const level2 = await createApiUser("LVL3MID2");
    const level1 = await createApiUser("LVL3MID1");
    const buyer = await createApiUser("LVL3BUY");
    await activateUserPackage(level3.id, "SILVER");
    await createUplineChain(buyer, [level1, level2, level3]);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "level-3-payment");

    expect(response.status).toBe(200);
    await expectLevelBonus(level3.id, order.id, 3, "10000.00", "2.00");
  });

  it("credits level 10 bonus 1% when upline unlocks level 10", async () => {
    const buyer = await createApiUser("LVL10BUY");
    const uplines = [];
    for (let index = 1; index <= 10; index += 1) {
      uplines.push(await createApiUser(`LV10U${index}`));
    }
    await activateUserPackage(uplines[9]!.id, "PLATINUM");
    await createUplineChain(buyer, uplines);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "level-10-payment");

    expect(response.status).toBe(200);
    await expectLevelBonus(uplines[9]!.id, order.id, 10, "5000.00", "1.00");
  });

  it("credits level 5 bonus for Gold upline", async () => {
    const buyer = await createApiUser("LVL5BUY");
    const uplines = [];
    for (let index = 1; index <= 5; index += 1) {
      uplines.push(await createApiUser(`LV5U${index}`));
    }
    await activateUserPackage(uplines[4]!.id, "GOLD");
    await createUplineChain(buyer, uplines);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "level-5-payment");

    expect(response.status).toBe(200);
    await expectLevelBonus(uplines[4]!.id, order.id, 5, "10000.00", "2.00");
  });

  it("skips level bonus for Basic uplines", async () => {
    const level2 = await createApiUser("LOCKTOP");
    const level1 = await createApiUser("LOCKMID");
    const buyer = await createApiUser("LOCKBUY");
    await createUplineChain(buyer, [level1, level2]);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "locked-level-payment");

    expect(response.status).toBe(200);
    expect(await prisma.commission.count({
      where: {
        beneficiaryId: level2.id,
        type: "LEVEL_BONUS",
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: order.id
      }
    })).toBe(0);
  });

  it("does not duplicate level bonus when payment success is called twice", async () => {
    const sponsor = await createApiUser("LVLDUPSP");
    const buyer = await createApiUser("LVLDUPBY");
    await activateUserPackage(sponsor.id, "SILVER");
    await createDirectReferral(sponsor.id, buyer.id);
    const order = await createOrderFor(buyer, "SILVER");

    await payOrder(buyer, order.id, "level-duplicate-first");
    const duplicate = await payOrder(buyer, order.id, "level-duplicate-second");

    expect(duplicate.status).toBe(409);
    await expectLevelBonus(sponsor.id, order.id, 1, "40000.00", "8.00");
  });

  it("auto upgrades Silver sponsor to Gold with 5 active direct Silver members", async () => {
    const sponsor = await createApiUser("AUTOGLD");
    const buyer = await createApiUser("AUTOGLDBY");
    await activateUserPackage(sponsor.id, "SILVER");
    await addActiveSilverDirectReferrals(sponsor.id, 4, "AUTOGLDSLOT");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "auto-gold-payment");

    expect(response.status).toBe(200);
    await expectActivePackage(sponsor.id, "GOLD");
  });

  it("auto upgrades Gold sponsor to Platinum with 10 active direct Silver members without downgrade", async () => {
    const sponsor = await createApiUser("AUTOPLT");
    const buyer = await createApiUser("AUTOPLTBY");
    await activateUserPackage(sponsor.id, "GOLD");
    await addActiveSilverDirectReferrals(sponsor.id, 9, "AUTOPLTSLOT");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createOrderFor(buyer, "SILVER");
    const response = await payOrder(buyer, order.id, "auto-platinum-payment");

    expect(response.status).toBe(200);
    await expectActivePackage(sponsor.id, "PLATINUM");
  });

  it("blocks membership downgrade orders", async () => {
    const user = await createApiUser("NODOWN");
    await activateUserPackage(user.id, "PLATINUM");
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

    const response = await api("/api/v1/membership/orders", {
      method: "POST",
      token: tokenFor(user),
      body: { packageId: silver.id }
    });

    expect(response.status).toBe(409);
    await expectActivePackage(user.id, "PLATINUM");
  });

  it("credits Platinum 10 direct sponsor reward Rp500.000 once", async () => {
    const user = await createApiUser("REWARD10");
    await addActiveSilverDirectReferrals(user.id, 10, "REWARD10SLOT");
    const order = await createOrderFor(user, "PLATINUM");

    const response = await payOrder(user, order.id, "reward-platinum-payment");

    expect(response.status).toBe(200);
    await expectRewardBonus(user.id, "500000.00");
  });

  it("does not credit reward for Platinum user with only 9 direct sponsors", async () => {
    const user = await createApiUser("REWARD09");
    await addActiveSilverDirectReferrals(user.id, 9, "REWARD09SLOT");
    const order = await createOrderFor(user, "PLATINUM");

    const response = await payOrder(user, order.id, "reward-nine-payment");

    expect(response.status).toBe(200);
    await expectNoRewardBonus(user.id);
  });

  it("does not credit reward for Gold user with 10 direct sponsors", async () => {
    const user = await createApiUser("REWARDGD");
    await addDirectReferralSlots(user.id, 10, "REWARDGDSLOT");
    const order = await createOrderFor(user, "GOLD");

    const response = await payOrder(user, order.id, "reward-gold-payment");

    expect(response.status).toBe(200);
    await expectNoRewardBonus(user.id);
  });

  it("does not duplicate reward if payment success is called twice", async () => {
    const user = await createApiUser("REWARDDP");
    await addActiveSilverDirectReferrals(user.id, 10, "REWARDDPSLOT");
    const order = await createOrderFor(user, "PLATINUM");

    await payOrder(user, order.id, "reward-first-payment");
    const duplicate = await payOrder(user, order.id, "reward-second-payment");

    expect(duplicate.status).toBe(409);
    await expectRewardBonus(user.id, "500000.00");
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
  const body = await response.json() as { data: { id: string } };

  expect(response.status).toBe(201);
  return body.data;
}

async function createDirectReferral(sponsorId: string, userId: string) {
  await prisma.referral.create({
    data: {
      sponsorId,
      userId
    }
  });

  await prisma.referralLevel.create({
    data: {
      ancestorId: sponsorId,
      descendantId: userId,
      level: 1
    }
  });
}

async function createUplineChain(buyer: User, uplinesByLevel: User[]) {
  if (uplinesByLevel.length === 0) {
    return;
  }

  await createDirectReferral(uplinesByLevel[0]!.id, buyer.id);

  for (let index = 1; index < uplinesByLevel.length; index += 1) {
    await prisma.referral.create({
      data: {
        sponsorId: uplinesByLevel[index]!.id,
        userId: uplinesByLevel[index - 1]!.id
      }
    });

    await prisma.referralLevel.create({
      data: {
        ancestorId: uplinesByLevel[index]!.id,
        descendantId: buyer.id,
        level: index + 1
      }
    });
  }
}

async function addDirectReferralSlots(sponsorId: string, count: number, prefix: string) {
  for (let index = 0; index < count; index += 1) {
    const user = await createApiUser(`${prefix}${index}`);
    await prisma.referral.create({
      data: {
        sponsorId,
        userId: user.id
      }
    });
  }
}

async function addActiveSilverDirectReferrals(sponsorId: string, count: number, prefix: string) {
  for (let index = 0; index < count; index += 1) {
    const user = await createApiUser(`${prefix}${index}`);
    await activateUserPackage(user.id, "SILVER");
    await createDirectReferral(sponsorId, user.id);
  }
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({
    where: { userId, status: "ACTIVE" },
    data: {
      status: "EXPIRED",
      expiresAt: new Date()
    }
  });
  await prisma.userMembership.create({
    data: {
      userId,
      membershipId: membership.id,
      status: "ACTIVE",
      activeAt: new Date()
    }
  });
  await prisma.user.update({
    where: { id: userId },
    data: { membershipId: membership.id }
  });
}

async function payOrder(user: User, orderId: string, paymentReference: string) {
  return api(`/api/v1/membership/orders/${orderId}/payment-success`, {
    method: "POST",
    token: tokenFor(user),
    body: { paymentReference }
  });
}

async function expectActivePackage(userId: string, tier: MembershipTier) {
  const activeMemberships = await prisma.userMembership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { membership: true }
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: true }
  });

  expect(activeMemberships).toHaveLength(1);
  expect(activeMemberships[0]?.membership.tier).toBe(tier);
  expect(user.membership?.tier).toBe(tier);
}

async function expectMembershipStatusByOrder(orderId: string, status: "ACTIVE" | "EXPIRED" | "CANCELLED") {
  const membership = await prisma.userMembership.findUniqueOrThrow({
    where: { orderId }
  });

  expect(membership.status).toBe(status);
}

async function expectWallet(userId: string, expectedBalance: string, expectedPpobTransactions: number) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const ppobTransactions = await prisma.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type: "PPOB_BENEFIT"
    }
  });

  expect(wallet.ppobBalance.toFixed(2)).toBe(expectedBalance);
  expect(wallet.balance.toFixed(2)).toBe("0.00");
  expect(wallet.cashBalance.toFixed(2)).toBe("0.00");
  expect(ppobTransactions).toHaveLength(expectedPpobTransactions);
}

async function expectSponsorBonus(
  sponsorId: string,
  orderId: string,
  expectedAmount: string,
  type: "SPONSOR_BONUS" | "BASIC_SPONSOR_BONUS"
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sponsorId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type,
      referenceType: "MEMBERSHIP_ORDER",
      referenceId: orderId
    }
  });
  const commissions = await prisma.commission.findMany({
    where: {
      beneficiaryId: sponsorId,
      type,
      triggerType: "MEMBERSHIP_ORDER",
      triggerId: orderId,
      level: 1
    }
  });

  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.amount.toFixed(2)).toBe(expectedAmount);
  expect(commissions).toHaveLength(1);
  expect(commissions[0]?.amount.toFixed(2)).toBe(expectedAmount);
  expect(commissions[0]?.status).toBe("POSTED");
}

async function expectLevelBonus(
  uplineId: string,
  orderId: string,
  level: number,
  expectedAmount: string,
  expectedRate: string
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: uplineId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type: "LEVEL_BONUS",
      referenceType: "MEMBERSHIP_ORDER",
      referenceId: orderId
    }
  });
  const commissions = await prisma.commission.findMany({
    where: {
      beneficiaryId: uplineId,
      type: "LEVEL_BONUS",
      triggerType: "MEMBERSHIP_ORDER",
      triggerId: orderId,
      level
    }
  });

  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.amount.toFixed(2)).toBe(expectedAmount);
  expect(commissions).toHaveLength(1);
  expect(commissions[0]?.amount.toFixed(2)).toBe(expectedAmount);
  expect(commissions[0]?.rate?.toFixed(2)).toBe(expectedRate);
  expect(commissions[0]?.status).toBe("POSTED");
}

async function expectRewardBonus(userId: string, expectedAmount: string) {
  const rewards = await prisma.rewardTransaction.findMany({
    where: {
      userId,
      referenceType: "REWARD_MILESTONE",
      referenceId: "DIRECT_SILVER_10"
    }
  });

  expect(rewards).toHaveLength(1);
  expect(rewards[0]?.amount.toFixed(2)).toBe(expectedAmount);
  expect(rewards[0]?.status).toBe("PENDING");
}

async function expectNoRewardBonus(userId: string) {
  const rewardTransactions = await prisma.rewardTransaction.count({
    where: {
      userId,
      referenceType: "REWARD_MILESTONE"
    }
  });

  expect(rewardTransactions).toBe(0);
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: randomUUID()
  });
}
