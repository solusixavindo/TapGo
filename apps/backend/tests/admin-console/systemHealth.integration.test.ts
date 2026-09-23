import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * /admin/system/health — diagnostik server (memori, disk, DB/Redis) untuk
 * Super Admin VIP. Endpoint ini memperlihatkan kondisi infrastruktur, jadi
 * gerbangnya sama ketatnya dengan laba rugi: VIP saja, bukan SUPER_ADMIN
 * biasa (lihat adminRoleSeparation.integration.test.ts untuk pola serupa
 * pada /reports/profit-loss).
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Admin console — kesehatan server", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-system-health";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-system-health";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  async function createUser(role: UserRole) {
    sequence += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: `Pengguna Kesehatan ${sequence}`,
        phone: `+628${String(700000000 + sequence)}`,
        referralCode: `HEALTH${String(sequence).padStart(6, "0")}`,
        role,
        membershipId: basic.id
      }
    });
  }

  function tokenFor(user: User) {
    return signAccessToken({ sub: user.id, role: user.role, sessionId: `sess-${user.id}` });
  }

  it("menolak ADMIN dan SUPER_ADMIN biasa — hanya SUPER_ADMIN_VIP yang boleh", async () => {
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    for (const actor of [admin, superAdmin]) {
      const response = await fetch(`${baseUrl}/api/v1/admin/system/health`, {
        headers: { authorization: `Bearer ${tokenFor(actor)}` }
      });
      expect(response.status, actor.role).toBe(403);
    }
  });

  it("mengembalikan status server, memori, dan koneksi database untuk SUPER_ADMIN_VIP", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const response = await fetch(`${baseUrl}/api/v1/admin/system/health`, {
      headers: { authorization: `Bearer ${tokenFor(vip)}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        server: { nodeVersion: string; cpuCount: number };
        memory: { totalBytes: number; usedPercent: number };
        database: { connected: boolean; latencyMs: number | null };
        redis: { configured: boolean };
        checkedAt: string;
      };
    };
    expect(body.data.server.cpuCount).toBeGreaterThan(0);
    expect(body.data.memory.totalBytes).toBeGreaterThan(0);
    // Server benar-benar terhubung ke database test yang sama dipakai uji ini.
    expect(body.data.database.connected).toBe(true);
    expect(body.data.database.latencyMs).not.toBeNull();
    expect(typeof body.data.checkedAt).toBe("string");
  });

  it("/system/errors menolak ADMIN dan SUPER_ADMIN biasa — hanya SUPER_ADMIN_VIP", async () => {
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    for (const actor of [admin, superAdmin]) {
      const response = await fetch(`${baseUrl}/api/v1/admin/system/errors`, {
        headers: { authorization: `Bearer ${tokenFor(actor)}` }
      });
      expect(response.status, actor.role).toBe(403);
    }
  });

  it("/system/errors melapor belum dikonfigurasi untuk SUPER_ADMIN_VIP tanpa SENTRY_AUTH_TOKEN di lingkungan test", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const response = await fetch(`${baseUrl}/api/v1/admin/system/errors`, {
      headers: { authorization: `Bearer ${tokenFor(vip)}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(false);
  });
});
