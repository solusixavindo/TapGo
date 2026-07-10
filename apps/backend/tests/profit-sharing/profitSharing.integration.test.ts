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

describe.skipIf(!runIntegration)("Profit sharing admin API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-profit-sharing-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-profit-sharing-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
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
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("allows admin to create a profit sharing period", async () => {
    const admin = await createApiUser("ADMINPS1", "ADMIN");

    const response = await createPeriod(admin, 5, 2026, 300000);
    const body = await response.json() as { data: { status: string; periodMonth: number; periodYear: number; netProfitAmount: string; totalPoolAmount: string } };

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("DRAFT");
    expect(body.data.periodMonth).toBe(5);
    expect(body.data.periodYear).toBe(2026);
    expect(body.data.netProfitAmount).toBe("300000");
    expect(body.data.totalPoolAmount).toBe("180000");
  });

  it("allows super admin to approve a draft period", async () => {
    const admin = await createApiUser("ADMINPS2", "SUPER_ADMIN");
    const period = await createPeriodData(admin);

    const response = await api(`/api/v1/admin/profit-sharing/periods/${period.id}/approve`, {
      method: "POST",
      token: tokenFor(admin)
    });
    const body = await response.json() as { data: { status: string; approvedAt: string | null } };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("APPROVED");
    expect(body.data.approvedAt).not.toBeNull();
  });

  it("distributes final profit sharing only to qualified categories", async () => {
    const admin = await createApiUser("ADMINPS3", "SUPER_ADMIN");
    const activeA = await createActiveMember("ACTIVEA", "SILVER");
    const activeB = await createActiveMember("ACTIVEB", "GOLD");
    await createApiUser("INACTIVE");
    const period = await createPeriodData(admin, 300000);
    await approvePeriod(admin, period.id);

    const response = await api(`/api/v1/admin/profit-sharing/periods/${period.id}/distribute`, {
      method: "POST",
      token: tokenFor(admin)
    });
    const body = await response.json() as { data: { status: string; distributions: Array<{ userId: string; amount: string; status: string }> } };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("DISTRIBUTED");
    expect(body.data.distributions).toHaveLength(1);
    expect(body.data.distributions.map((item) => item.userId)).toEqual([activeB.id]);
    expect(body.data.distributions.every((item) => item.amount === "36000")).toBe(true);
    expect(body.data.distributions.every((item) => item.status === "POSTED")).toBe(true);
    expect(body.data.distributions.some((item) => item.userId === activeA.id)).toBe(false);
  });

  it("does not distribute to inactive members", async () => {
    const admin = await createApiUser("ADMINPS4", "SUPER_ADMIN");
    const active = await createActiveMember("ACTIVE1", "PLATINUM");
    const inactive = await createActiveMember("OLDMEMB", "SILVER");
    await prisma.userMembership.updateMany({
      where: { userId: inactive.id },
      data: { status: "EXPIRED", expiresAt: new Date() }
    });
    const period = await createPeriodData(admin, 100000);
    await approvePeriod(admin, period.id);
    await distributePeriod(admin, period.id);

    const distributions = await prisma.profitSharingDistribution.findMany({ where: { periodId: period.id } });

    expect(distributions).toHaveLength(1);
    expect(distributions[0]?.userId).toBe(active.id);
  });

  it("blocks distributing a period twice", async () => {
    const admin = await createApiUser("ADMINPS5", "SUPER_ADMIN");
    await createActiveMember("ACTIVEDP", "GOLD");
    const period = await createPeriodData(admin, 100000);
    await approvePeriod(admin, period.id);
    await distributePeriod(admin, period.id);

    const response = await distributePeriod(admin, period.id);
    const body = await response.json() as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("PROFIT_SHARING_ALREADY_DISTRIBUTED");
  });

  it("records wallet transactions and commission history", async () => {
    const admin = await createApiUser("ADMINPS6", "SUPER_ADMIN");
    const active = await createActiveMember("ACTIVEPS", "GOLD");
    const period = await createPeriodData(admin, 100000);
    await approvePeriod(admin, period.id);
    await distributePeriod(admin, period.id);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: active.id } });
    const walletTransactions = await prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: "PROFIT_SHARING",
        referenceType: "PROFIT_SHARING_PERIOD",
        referenceId: period.id
      }
    });
    const commissions = await prisma.commission.findMany({
      where: {
        beneficiaryId: active.id,
        type: "PROFIT_SHARING",
        triggerType: "PROFIT_SHARING_PERIOD",
        triggerId: period.id,
        level: 1
      }
    });

    expect(wallet.balance.toFixed(2)).toBe("12000.00");
    expect(wallet.cashBalance.toFixed(2)).toBe("12000.00");
    expect(walletTransactions).toHaveLength(1);
    expect(walletTransactions[0]?.amount.toFixed(2)).toBe("12000.00");
    expect(commissions).toHaveLength(1);
    expect(commissions[0]?.amount.toFixed(2)).toBe("12000.00");
    expect(commissions[0]?.status).toBe("POSTED");
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

async function createPeriod(admin: User, periodMonth: number, periodYear: number, netProfitAmount: number) {
  return api("/api/v1/admin/profit-sharing/periods", {
    method: "POST",
    token: tokenFor(admin),
    body: { periodMonth, periodYear, netProfitAmount }
  });
}

async function createPeriodData(admin: User, netProfitAmount = 300000) {
  const response = await createPeriod(admin, 5, 2026, netProfitAmount);
  const body = await response.json() as { data: { id: string } };

  expect(response.status).toBe(201);
  return body.data;
}

async function approvePeriod(admin: User, periodId: string) {
  const response = await api(`/api/v1/admin/profit-sharing/periods/${periodId}/approve`, {
    method: "POST",
    token: tokenFor(admin)
  });

  expect(response.status).toBe(200);
  return response;
}

async function distributePeriod(admin: User, periodId: string) {
  return api(`/api/v1/admin/profit-sharing/periods/${periodId}/distribute`, {
    method: "POST",
    token: tokenFor(admin)
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

async function createActiveMember(referralCode: string, tier: MembershipTier): Promise<User> {
  const user = await createApiUser(referralCode);
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.user.update({
    where: { id: user.id },
    data: { membershipId: membership.id }
  });
  await prisma.userMembership.create({
    data: {
      userId: user.id,
      membershipId: membership.id,
      status: "ACTIVE"
    }
  });

  return user;
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: randomUUID()
  });
}
