import { User, UserRole } from "@prisma/client";
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

describe.skipIf(!runIntegration)("Admin dashboard growth API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-growth-api";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-growth-api";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  it("menghitung tren pendaftaran harian dan mengisi 0 untuk hari tanpa pendaftaran", async () => {
    const today = startOfUtcDay(new Date());
    await createUserAt("TREND001", offsetDays(today, 0));
    await createUserAt("TREND002", offsetDays(today, 0));
    await createUserAt("TREND003", offsetDays(today, -2));
    // Di luar jendela 30 hari — tidak boleh ikut terhitung.
    await createUserAt("TREND004", offsetDays(today, -45));

    const admin = await createUser("ADMTREND1", "ADMIN");
    const response = await api("/api/v1/admin/dashboard/growth", { token: tokenFor(admin) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { registrationTrend: Array<{ date: string; count: number }> };
    };

    expect(body.data.registrationTrend).toHaveLength(30);
    const byDate = new Map(body.data.registrationTrend.map((row) => [row.date, row.count]));
    expect(byDate.get(isoDate(today))).toBe(2);
    expect(byDate.get(isoDate(offsetDays(today, -2)))).toBe(1);
    expect(byDate.get(isoDate(offsetDays(today, -1)))).toBe(0);
    // Total keseluruhan tetap hanya 3 (TREND004 di luar jendela).
    const total = [...byDate.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(3);
  });

  it("user aktif = login dalam N hari terakhir; belum pernah login tidak terhitung", async () => {
    const now = new Date();
    await createUserWithLastLogin("ACT001", offsetDays(now, -1)); // aktif 7 & 30
    await createUserWithLastLogin("ACT002", offsetDays(now, -6)); // aktif 7 & 30
    await createUserWithLastLogin("ACT003", offsetDays(now, -15)); // hanya aktif 30
    await createUserWithLastLogin("ACT004", offsetDays(now, -40)); // tidak aktif keduanya
    await createUserWithLastLogin("ACT005", null); // belum pernah login

    const admin = await createUser("ADMACT001", "ADMIN");
    const response = await api("/api/v1/admin/dashboard/growth", { token: tokenFor(admin) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { activeUsers7d: number; activeUsers30d: number };
    };

    expect(body.data.activeUsers7d).toBe(2);
    expect(body.data.activeUsers30d).toBe(3);
  });

  it("ditolak untuk USER biasa", async () => {
    const user = await createUser("GROWTHUSR", "USER");
    const response = await api("/api/v1/admin/dashboard/growth", { token: tokenFor(user) });
    expect(response.status).toBe(403);
  });

  it("menghitung pending approvals gabungan (member request + reward + withdrawal)", async () => {
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const buyer = await createUser("PENDBUY01", "USER");

    // Order PAID tapi belum aktif = menunggu verifikasi admin.
    await prisma.membershipOrder.create({
      data: {
        userId: buyer.id,
        membershipId: silver.id,
        status: "PAID",
        totalAmount: "500000.00",
        packageSnapshot: {},
        paidAt: new Date()
      }
    });
    // Order PENDING (belum bayar) TIDAK boleh ikut terhitung.
    await prisma.membershipOrder.create({
      data: {
        userId: buyer.id,
        membershipId: basic.id,
        status: "PENDING",
        totalAmount: "0.00",
        packageSnapshot: {}
      }
    });

    await prisma.rewardTransaction.create({
      data: {
        userId: buyer.id,
        threshold: 10,
        directSilverCount: 10,
        amount: "500000.00",
        status: "PENDING",
        referenceId: "DIRECT_SILVER_10"
      }
    });

    const wallet = await prisma.wallet.create({
      data: { userId: buyer.id, balance: "50000.00", cashBalance: "50000.00", ppobBalance: "0.00" }
    });
    await prisma.withdrawal.create({
      data: {
        userId: buyer.id,
        walletId: wallet.id,
        amount: "50000.00",
        finalAmount: "50000.00",
        status: "PENDING",
        bankAccount: {}
      }
    });

    const admin = await createUser("ADMPEND001", "ADMIN");
    const response = await api("/api/v1/admin/dashboard/growth", { token: tokenFor(admin) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { pendingApprovals: { memberRequests: number; rewards: number; withdrawals: number; total: number } };
    };
    expect(body.data.pendingApprovals).toEqual({
      memberRequests: 1,
      rewards: 1,
      withdrawals: 1,
      total: 3
    });
  });
});

describe.skipIf(!runIntegration)("Admin dashboard document retention + activity feed", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-growth-api";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-growth-api";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  it("menandai dokumen KYC yang mendekati batas retensi, mengecualikan yang sudah lewat/dipurge/order selesai", async () => {
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const buyer = await createUser("RETBUY001", "USER");
    const order = await prisma.membershipOrder.create({
      data: {
        userId: buyer.id,
        membershipId: silver.id,
        status: "PAID",
        totalAmount: "500000.00",
        packageSnapshot: {},
        paidAt: new Date()
      }
    });

    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 jam lagi — dalam ambang 6 jam
    await prisma.membershipDocument.create({
      data: { orderId: order.id, userId: buyer.id, type: "KTP", expiresAt: soon }
    });

    // Sudah lewat batas — tidak boleh ikut (bukan "mendekati", sudah tidak
    // tersaji lagi).
    const expired = await createUser("RETBUY002", "USER");
    const expiredOrder = await prisma.membershipOrder.create({
      data: {
        userId: expired.id,
        membershipId: silver.id,
        status: "PAID",
        totalAmount: "500000.00",
        packageSnapshot: {},
        paidAt: new Date()
      }
    });
    await prisma.membershipDocument.create({
      data: {
        orderId: expiredOrder.id,
        userId: expired.id,
        type: "KTP",
        expiresAt: new Date(Date.now() - 1000)
      }
    });

    // Masih jauh (24 jam lagi) — di luar ambang 6 jam default.
    const far = await createUser("RETBUY003", "USER");
    const farOrder = await prisma.membershipOrder.create({
      data: {
        userId: far.id,
        membershipId: silver.id,
        status: "PAID",
        totalAmount: "500000.00",
        packageSnapshot: {},
        paidAt: new Date()
      }
    });
    await prisma.membershipDocument.create({
      data: {
        orderId: farOrder.id,
        userId: far.id,
        type: "KTP",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });

    const admin = await createUser("ADMRET001", "ADMIN");
    const response = await api("/api/v1/admin/dashboard/documents-nearing-retention", {
      token: tokenFor(admin)
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ orderId: string; memberName: string; documentType: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.orderId).toBe(order.id);
    expect(body.data[0]?.documentType).toBe("KTP");
  });

  it("aktivitas admin terbaru hanya untuk SUPER_ADMIN_VIP dan hanya memuat aksi role/scope", async () => {
    const vip = await createUser("ADMACTVIP", "SUPER_ADMIN_VIP");
    const admin = await createUser("ADMACTADM", "ADMIN");
    const target = await createUser("ADMACTTGT", "USER");

    await prisma.auditLog.create({
      data: {
        actorId: vip.id,
        action: "ADMIN_ROLE_ASSIGNED",
        entityType: "USER",
        entityId: target.id,
        metadata: { previousRole: "USER", newRole: "ADMIN" }
      }
    });
    // Aksi tak terkait role/scope — tidak boleh ikut muncul di feed ini.
    await prisma.auditLog.create({
      data: {
        actorId: vip.id,
        action: "SOME_UNRELATED_TRANSACTION_EVENT",
        entityType: "USER",
        entityId: target.id,
        metadata: {}
      }
    });

    const blocked = await api("/api/v1/admin/dashboard/activity", { token: tokenFor(admin) });
    expect(blocked.status).toBe(403);

    const allowed = await api("/api/v1/admin/dashboard/activity", { token: tokenFor(vip) });
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as {
      data: Array<{ action: string; actorName: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.action).toBe("ADMIN_ROLE_ASSIGNED");
    expect(body.data[0]?.actorName).toBe(vip.fullName);
  });
});

function startOfUtcDay(date: Date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function offsetDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

let sequence = 0;

async function createUserAt(referralCode: string, createdAt: Date): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `08${String(200000000 + sequence)}`,
      referralCode,
      role: "USER",
      membershipId: basic.id,
      createdAt
    }
  });
}

async function createUserWithLastLogin(
  referralCode: string,
  lastLoginAt: Date | null
): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `08${String(300000000 + sequence)}`,
      referralCode,
      role: "USER",
      membershipId: basic.id,
      ...(lastLoginAt ? { lastLoginAt } : {})
    }
  });
}

async function createUser(referralCode: string, role: UserRole): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `08${String(400000000 + sequence)}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function api(path: string, options: { token?: string } = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {}
  });
}
