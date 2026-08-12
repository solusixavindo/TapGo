import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  isAdminRole,
  isSuperAdminRole,
  isTopLevelRole,
  roleSatisfies,
  roleSatisfiesAny
} from "../../src/core/security/roleHierarchy.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Role puncak SUPER_ADMIN_VIP.
 *
 * Menambah role di ATAS SUPER_ADMIN punya satu kegagalan khas: puluhan penjaga
 * menuliskan "SUPER_ADMIN" harfiah, sehingga role yang seharusnya lebih tinggi
 * justru mendapat akses LEBIH SEDIKIT. Berkas ini menembak seluruh permukaan
 * admin secara tabel untuk membuktikan kebalikannya.
 *
 * Dua hal yang justru TIDAK boleh berubah dan ikut diuji:
 * - Role tetap bukan kewenangan. VIP tanpa grant ADMIN_SCOPE_MANAGE tetap
 *   ditolak mengelola scope.
 * - Tidak ada bypass ke jalur operasional driver. Route driver menuntut profil
 *   driver aktif, dan role tertinggi sekalipun tidak menggantikannya.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

type Endpoint = { method: string; path: string };

/** Permukaan yang cukup ADMIN. */
const ADMIN_ENDPOINTS: ReadonlyArray<Endpoint> = [
  { method: "GET", path: "/api/v1/admin/dashboard/summary" },
  { method: "GET", path: "/api/v1/admin/members" },
  { method: "GET", path: "/api/v1/admin/member-requests" },
  { method: "GET", path: "/api/v1/admin/invoices" },
  { method: "GET", path: "/api/v1/admin/payments" },
  { method: "GET", path: "/api/v1/admin/commissions" },
  { method: "GET", path: "/api/v1/admin/wallets" },
  { method: "GET", path: "/api/v1/admin/withdrawals" },
  { method: "GET", path: "/api/v1/admin/rewards" },
  { method: "GET", path: "/api/v1/admin/delete-requests" },
  { method: "GET", path: "/api/v1/admin/contact-messages" },
  { method: "GET", path: "/api/v1/admin/reports/bonus" },
  { method: "GET", path: "/api/v1/admin/reports/ppob" },
  { method: "GET", path: "/api/v1/admin/reports/reward" }
];

/** Permukaan yang menuntut SUPER_ADMIN. */
const SUPER_ADMIN_ENDPOINTS: ReadonlyArray<Endpoint> = [
  { method: "GET", path: "/api/v1/admin/commission-settings" },
  { method: "POST", path: "/api/v1/admin/roles" },
  { method: "PUT", path: "/api/v1/admin/app-settings" },
  { method: "GET", path: "/api/v1/admin/founder-chairman" },
  { method: "GET", path: "/api/v1/admin/founder-platinum" }
];

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let resetRateLimit: () => void = () => {};
let sequence = 0;

describe.skipIf(!runIntegration)("Super admin VIP role", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-super-admin-vip";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-super-admin-vip";

    const [{ createApp }, tokenService, rateLimitModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/core/security/rateLimit.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    // Tabel ini menembak lebih banyak permintaan daripada batas admin. Yang
    // direset hanya PENGHITUNG antar test; batas produksinya tidak dilemahkan.
    const limiters = [
      rateLimitModule.adminRateLimiter,
      rateLimitModule.apiRateLimiter
    ] as unknown as Array<{ resetKey?: (key: string) => void }>;
    resetRateLimit = () => {
      for (const limiter of limiters) {
        for (const key of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) {
          limiter.resetKey?.(key);
        }
      }
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    resetRateLimit();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  // --- Tangga role ---------------------------------------------------------

  it("menempatkan VIP di atas SUPER_ADMIN dan ADMIN", () => {
    expect(roleSatisfies("SUPER_ADMIN_VIP", "SUPER_ADMIN")).toBe(true);
    expect(roleSatisfies("SUPER_ADMIN_VIP", "ADMIN")).toBe(true);
    expect(roleSatisfies("SUPER_ADMIN", "ADMIN")).toBe(true);

    // Tangganya searah: yang di bawah tidak pernah memenuhi yang di atas.
    expect(roleSatisfies("SUPER_ADMIN", "SUPER_ADMIN_VIP")).toBe(false);
    expect(roleSatisfies("ADMIN", "SUPER_ADMIN")).toBe(false);

    expect(isAdminRole("SUPER_ADMIN_VIP")).toBe(true);
    expect(isSuperAdminRole("SUPER_ADMIN_VIP")).toBe(true);
    expect(isTopLevelRole("SUPER_ADMIN_VIP")).toBe(true);
    expect(isTopLevelRole("SUPER_ADMIN")).toBe(false);
  });

  it("tidak pernah menjadikan admin sebagai USER maupun DRIVER", () => {
    // Ini yang mencegah role admin menyelinap ke jalur penumpang dan pengemudi.
    for (const role of ["ADMIN", "SUPER_ADMIN", "SUPER_ADMIN_VIP"] as const) {
      expect(roleSatisfies(role, "USER")).toBe(false);
      expect(roleSatisfies(role, "DRIVER")).toBe(false);
    }
    expect(roleSatisfies("USER", "DRIVER")).toBe(false);
    expect(roleSatisfies("DRIVER", "USER")).toBe(false);
    expect(roleSatisfies("USER", "USER")).toBe(true);
    expect(roleSatisfiesAny("SUPER_ADMIN_VIP", ["ADMIN", "SUPER_ADMIN"])).toBe(true);
    expect(roleSatisfiesAny("USER", ["ADMIN", "SUPER_ADMIN"])).toBe(false);
  });

  // --- Permukaan HTTP ------------------------------------------------------

  it("membuka SELURUH permukaan ADMIN untuk VIP", async () => {
    const vip = await createUser("VIPADM1", "SUPER_ADMIN_VIP");
    const blocked: string[] = [];
    for (const endpoint of ADMIN_ENDPOINTS) {
      const response = await call(endpoint, vip);
      if (response.status === 401 || response.status === 403) {
        blocked.push(`${endpoint.method} ${endpoint.path} -> ${response.status}`);
      }
    }
    expect(blocked, "permukaan ADMIN tertutup untuk role puncak").toEqual([]);
  });

  it("membuka SELURUH permukaan SUPER_ADMIN untuk VIP", async () => {
    const vip = await createUser("VIPSA1", "SUPER_ADMIN_VIP");
    const blocked: string[] = [];
    for (const endpoint of SUPER_ADMIN_ENDPOINTS) {
      const response = await call(endpoint, vip);
      // 501 berarti penjaga lolos dan endpoint-nya memang stub. Yang dinilai
      // hanya penolakan otorisasi.
      if (response.status === 401 || response.status === 403) {
        blocked.push(`${endpoint.method} ${endpoint.path} -> ${response.status}`);
      }
    }
    expect(blocked, "permukaan SUPER_ADMIN tertutup untuk role puncak").toEqual([]);
  });

  it("tetap menolak ADMIN biasa pada permukaan SUPER_ADMIN", async () => {
    const admin = await createUser("VIPCTRL1", "ADMIN");
    const leaked: string[] = [];
    for (const endpoint of SUPER_ADMIN_ENDPOINTS) {
      const response = await call(endpoint, admin);
      if (response.status !== 403) {
        leaked.push(`${endpoint.method} ${endpoint.path} -> ${response.status}`);
      }
    }
    // Kontrol negatif: membuktikan test di atas bukan lulus karena penjaganya
    // memang sudah longgar untuk semua orang.
    expect(leaked, "permukaan SUPER_ADMIN tertembus ADMIN biasa").toEqual([]);
  });

  it("tetap menolak role USER walau tangga role ditambah", async () => {
    const user = await createUser("VIPUSR1", "USER");
    const leaked: string[] = [];
    for (const endpoint of [...ADMIN_ENDPOINTS, ...SUPER_ADMIN_ENDPOINTS]) {
      const response = await call(endpoint, user);
      if (response.status !== 403) {
        leaked.push(`${endpoint.method} ${endpoint.path} -> ${response.status}`);
      }
    }
    expect(leaked, "permukaan admin terbuka untuk role USER").toEqual([]);
  });

  // --- Batas yang sengaja dipertahankan ------------------------------------

  it("tidak memberi VIP bypass ke jalur operasional driver", async () => {
    const vip = await createUser("VIPDRV1", "SUPER_ADMIN_VIP");

    // Kewenangan driver berasal dari profil driver ACTIVE di database, bukan
    // dari role. Role tertinggi sekalipun tidak menggantikannya.
    const response = await fetch(`${baseUrl}/api/v1/rides/driver/current`, {
      headers: { authorization: `Bearer ${tokenFor(vip)}` }
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("tidak memberi VIP kewenangan mengelola scope tanpa grant", async () => {
    const vip = await createUser("VIPSCOPE1", "SUPER_ADMIN_VIP");
    const target = await createUser("VIPSCOPE2", "ADMIN");

    const response = await fetch(`${baseUrl}/api/v1/admin/scope-grants`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(vip)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        targetUserId: target.id,
        scope: "DRIVER_APPLICATION_QUEUE_READ",
        reasonCode: "OPERATIONAL_ASSIGNMENT"
      })
    });

    // Role bukan kewenangan: tetap butuh ADMIN_SCOPE_MANAGE aktif di database.
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("ADMIN_SCOPE_MANAGE_REQUIRED");
  });

  it("melarang SUPER_ADMIN mencabut scope milik akun puncak", async () => {
    const vip = await createUser("VIPTARGET1", "SUPER_ADMIN_VIP");
    const superAdmin = await createUser("VIPACTOR1", "SUPER_ADMIN");

    // Kedua pihak memegang manage-scope, jadi yang menolak nanti bukan
    // ketiadaan kewenangan melainkan perlindungan akun puncak.
    await grantManageScope(superAdmin.id, superAdmin.id);
    const vipGrant = await grantManageScope(vip.id, superAdmin.id);

    const response = await fetch(`${baseUrl}/api/v1/admin/scope-grants/${vipGrant}/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(superAdmin)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ reasonCode: "ACCESS_REMOVAL" })
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("ADMIN_SCOPE_TOP_LEVEL_PROTECTED");

    const grant = await prisma.adminScopeGrant.findUniqueOrThrow({ where: { id: vipGrant } });
    expect(grant.status).toBe("ACTIVE");
  });

  it("mengizinkan sesama akun puncak saling mencabut scope", async () => {
    const owner = await createUser("VIPPEER1", "SUPER_ADMIN_VIP");
    const peer = await createUser("VIPPEER2", "SUPER_ADMIN_VIP");

    await grantManageScope(owner.id, owner.id);
    const peerGrant = await grantManageScope(peer.id, owner.id);

    const response = await fetch(`${baseUrl}/api/v1/admin/scope-grants/${peerGrant}/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(owner)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ reasonCode: "ACCESS_REMOVAL" })
    });

    expect(response.status).toBeLessThan(400);
    const grant = await prisma.adminScopeGrant.findUniqueOrThrow({ where: { id: peerGrant } });
    expect(grant.status).toBe("REVOKED");
  });
});

async function grantManageScope(userId: string, grantedById: string) {
  const grant = await prisma.adminScopeGrant.create({
    data: { userId, scope: "ADMIN_SCOPE_MANAGE", status: "ACTIVE", grantedById }
  });
  return grant.id;
}

async function call(endpoint: Endpoint, user: User): Promise<Response> {
  return fetch(`${baseUrl}${endpoint.path}`, {
    method: endpoint.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokenFor(user)}`
    },
    ...(endpoint.method === "GET" ? {} : { body: "{}" })
  });
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function createUser(label: string, role: UserRole): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${label}`,
      phone: `+6287${String(sequence).padStart(8, "0")}`,
      referralCode: `${label}${sequence}`.slice(0, 24),
      role,
      membershipId: basic.id
    }
  });
}
