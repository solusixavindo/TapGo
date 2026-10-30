import { MembershipTier, UserRole } from "@prisma/client";
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

/**
 * Alur pembagian laba lewat HTTP (dipakai layar konsol baru): buat periode -> pratinjau -> setujui -> bagikan.
 * Yang dijaga: hitungan 60% pool, 10% untuk Platinum dibagi rata (dua anggota Platinum), Admin ditolak, pratinjau hanya
 * membaca, dan setiap keputusan uang meninggalkan jejak audit tepat satu kali.
 */
let server: Server | undefined;
let baseUrl = "";
let sequence = 0;
let signAccessToken: (payload: { sub: string; role: UserRole; sessionId: string }) => string;

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Laba ${role} ${sequence}`,
      phone: `08125670${String(1000 + sequence)}`,
      referralCode: `LBA${String(sequence).padStart(6, "0")}`,
      role,
      status: "ACTIVE"
    }
  });
}

async function activate(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.create({ data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}

const tokenOf = (user: { id: string; role: UserRole }) => signAccessToken({ sub: user.id, role: user.role, sessionId: `s-${user.id}` });

async function call(path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${baseUrl}/api/v1/admin/profit-sharing${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const json = (await response.json().catch(() => ({}))) as { code?: string; data?: any };
  return { status: response.status, code: json.code, data: json.data };
}

describe.skipIf(!runIntegration)("Alur pembagian laba (HTTP)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-profit-sharing";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-profit-sharing";
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
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.adminRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("Admin biasa ditolak di semua jalur pembagian laba", async () => {
    const admin = await createUser("ADMIN");
    const token = tokenOf(admin);
    expect((await call("/periods", token)).status).toBe(403);
    expect((await call("/periods", token, { periodMonth: 10, periodYear: 2026, netProfitAmount: 1000000 })).status).toBe(403);
    expect((await call("/periods/00000000-0000-4000-8000-000000000001/preview", token)).status).toBe(403);
  });

  it("buat -> pratinjau (tanpa mengubah saldo) -> setujui -> bagikan; Platinum dibagi rata dan audit tercatat", async () => {
    const actor = await createUser("SUPER_ADMIN");
    const token = tokenOf(actor);
    const platinumA = await createUser("USER");
    const platinumB = await createUser("USER");
    const gold = await createUser("USER");
    await activate(platinumA.id, "PLATINUM");
    await activate(platinumB.id, "PLATINUM");
    await activate(gold.id, "GOLD");

    const created = await call("/periods", token, { periodMonth: 10, periodYear: 2026, netProfitAmount: 10000000 });
    expect(created.status).toBe(201);
    const periodId = created.data.id as string;
    expect(Number(created.data.totalPoolAmount)).toBe(6000000);
    expect(Number(created.data.platinumAllocation)).toBe(600000);

    const preview = await call(`/periods/${periodId}/preview`, token);
    expect(preview.status).toBe(200);
    expect(preview.data.platinum).toEqual({ recipients: 2, allocation: "600000.00", perMember: "300000.00" });
    expect(preview.data.gold).toEqual({ recipients: 1, allocation: "1200000.00", perMember: "1200000.00" });
    expect(preview.data.silver.recipients).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);

    // Bagikan sebelum disetujui ditolak.
    expect((await call(`/periods/${periodId}/distribute`, token, {})).status).toBe(409);

    expect((await call(`/periods/${periodId}/approve`, token, {})).status).toBe(200);
    const distributed = await call(`/periods/${periodId}/distribute`, token, {});
    expect(distributed.status).toBe(200);
    expect(distributed.data.status).toBe("DISTRIBUTED");

    const walletOf = async (userId: string) => (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).cashBalance.toFixed(2);
    expect(await walletOf(platinumA.id)).toBe("300000.00");
    expect(await walletOf(platinumB.id)).toBe("300000.00");
    expect(await walletOf(gold.id)).toBe("1200000.00");

    // Pembagian ulang ditolak dan tidak menggandakan saldo.
    expect((await call(`/periods/${periodId}/distribute`, token, {})).status).toBe(409);
    expect(await walletOf(platinumA.id)).toBe("300000.00");

    for (const action of ["PROFIT_SHARING_PERIOD_CREATED", "PROFIT_SHARING_PERIOD_APPROVED", "PROFIT_SHARING_PERIOD_DISTRIBUTED"]) {
      expect(await prisma.auditLog.count({ where: { action, entityId: periodId, actorId: actor.id } }), action).toBe(1);
    }
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PROFIT_SHARING_PERIOD_DISTRIBUTED" } });
    expect((audit.metadata as { recipients: number }).recipients).toBe(3);
  });
});
