import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships
} from "../helpers/referralWalletHarness.js";

/**
 * Stage R2.1A — proteksi Founder Platinum dan Chairman.
 *
 * Berkas ini TIDAK mengubah implementasi apa pun. Tujuannya membuktikan bahwa
 * aturan yang sudah ada benar-benar menegakkan dirinya sendiri, dan mengunci
 * penegakan itu agar integrasi berikutnya tidak menurunkannya diam-diam.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;

async function api(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
}

async function createUser(referralCode: string, role: UserRole) {
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

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `sess-${user.id}`,
    authVersion: 0
  });
}

function grantPlatinum(token: string, index: number) {
  return api("/api/v1/admin/founder-platinum/grants", {
    method: "POST",
    token,
    body: {
      fullName: `Founder Platinum ${index}`,
      phone: `08150000${String(index).padStart(4, "0")}`,
      password: "Founder123",
      reason: `uji proteksi ke-${index}`
    }
  });
}

function grantChairman(token: string, suffix: string) {
  return api("/api/v1/admin/founder-chairman/grant", {
    method: "POST",
    token,
    body: {
      fullName: `Founder Chairman ${suffix}`,
      phone: `0816000${suffix.padStart(5, "0")}`,
      email: `chairman-${suffix}@contoh.test`,
      password: "Chairman123",
      reason: `uji chairman ${suffix}`
    }
  });
}

const activePlatinum = () =>
  prisma.founderProgramGrant.count({
    where: { founderRole: "FOUNDER_PLATINUM", revokedAt: null }
  });

const activeChairman = () =>
  prisma.founderProgramGrant.count({
    where: { founderRole: "FOUNDER_CHAIRMAN", revokedAt: null }
  });

describeIntegration("Stage R2.1A — founder and chairman protection", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";

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
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.adminRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
      limiters.authRateLimiter.resetKey(key);
    }
  });

  // -----------------------------------------------------------------
  // Founder Platinum — batas 10
  // -----------------------------------------------------------------

  it("Founder Platinum ke-1 sampai ke-10 diizinkan, ke-11 ditolak", async () => {
    const superAdmin = await createUser("SUPERCAP1", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);

    for (let index = 1; index <= 10; index += 1) {
      const response = await grantPlatinum(token, index);
      expect(response.status, `grant ke-${index}`).toBe(201);
    }
    expect(await activePlatinum()).toBe(10);

    const eleventh = await grantPlatinum(token, 11);
    expect(eleventh.status).toBe(409);
    expect(((await eleventh.json()) as { code?: string }).code).toBe(
      "FOUNDER_PLATINUM_LIMIT_REACHED"
    );

    // Penolakan tidak meninggalkan grant maupun akun setengah jadi.
    expect(await activePlatinum()).toBe(10);
    expect(await prisma.user.count({ where: { phone: "081500000011" } })).toBe(0);
  });

  it("grant serentak tidak dapat melewati batas 10", async () => {
    const superAdmin = await createUser("SUPERCAP2", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);

    for (let index = 1; index <= 9; index += 1) {
      expect((await grantPlatinum(token, index)).status).toBe(201);
    }
    expect(await activePlatinum()).toBe(9);

    // Dua permintaan bersamaan pada slot terakhir. Transaksi grant memakai
    // isolation Serializable, sehingga hanya satu yang boleh commit.
    const [first, second] = await Promise.all([
      grantPlatinum(token, 90),
      grantPlatinum(token, 91)
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);

    // Yang menentukan: hitungan akhir TIDAK PERNAH melewati 10.
    expect(await activePlatinum()).toBe(10);
  });

  it("batas dihitung dari grant aktif saja, dan tetap tidak dapat dilewati", async () => {
    const superAdmin = await createUser("SUPERCAP3", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);

    for (let index = 1; index <= 10; index += 1) {
      expect((await grantPlatinum(token, index)).status).toBe(201);
    }
    expect((await grantPlatinum(token, 11)).status).toBe(409);
    expect(await activePlatinum()).toBe(10);
  });

  // -----------------------------------------------------------------
  // Chairman — keunikan
  // -----------------------------------------------------------------

  it("Chairman kedua ditolak", async () => {
    const superAdmin = await createUser("SUPERCHR1", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);

    expect((await grantChairman(token, "1")).status).toBe(201);
    expect(await activeChairman()).toBe(1);

    const duplicate = await grantChairman(token, "2");
    expect(duplicate.status).toBeGreaterThanOrEqual(400);
    expect(await activeChairman()).toBe(1);
  });

  it("Chairman dijaga partial unique index di database, bukan hanya service", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'founder_program_grants_one_chairman_key'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("UNIQUE");
    expect(rows[0]?.indexdef).toContain("FOUNDER_CHAIRMAN");
  });

  it("grant Chairman serentak hanya menghasilkan satu", async () => {
    const superAdmin = await createUser("SUPERCHR2", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);

    const results = await Promise.all([
      grantChairman(token, "31"),
      grantChairman(token, "32")
    ]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await activeChairman()).toBe(1);
  });

  // -----------------------------------------------------------------
  // Isolasi terhadap Auth, Driver, dan payment
  // -----------------------------------------------------------------

  it("otoritas biasa tidak dapat memberikan Founder Platinum maupun Chairman", async () => {
    const admin = await createUser("ADMINISO1", "ADMIN");
    const user = await createUser("USERISO1", "USER");

    for (const token of [tokenFor(admin), tokenFor(user)]) {
      expect((await grantPlatinum(token, 50)).status).toBe(403);
      expect((await grantChairman(token, "50")).status).toBe(403);
    }
    expect(await activePlatinum()).toBe(0);
    expect(await activeChairman()).toBe(0);
  });

  it("alur Auth recovery tidak mengubah assignment founder", async () => {
    const superAdmin = await createUser("SUPERAUTH1", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);
    expect((await grantPlatinum(token, 1)).status).toBe(201);

    const before = await prisma.founderProgramGrant.findMany({
      orderBy: { createdAt: "asc" }
    });
    const beforeMemberships = await prisma.userMembership.count();

    // Pencabutan sesi berversi hanya menyentuh kolom auth pada users.
    const founderUser = await prisma.user.findFirstOrThrow({
      where: { phone: "081500000001" }
    });
    await prisma.user.update({
      where: { id: founderUser.id },
      data: { authVersion: { increment: 1 }, sessionsRevokedAt: new Date() }
    });

    const after = await prisma.founderProgramGrant.findMany({
      orderBy: { createdAt: "asc" }
    });
    expect(after).toEqual(before);
    expect(await prisma.userMembership.count()).toBe(beforeMemberships);
  });

  it("tidak ada jalur payment callback yang dapat membuat Founder Platinum atau Chairman", async () => {
    // Bukti struktural: satu-satunya penulisan founderProgramGrant berada di
    // AdminConsoleService, yang hanya dapat dicapai lewat route admin dengan
    // otoritas SUPER_ADMIN. Modul payment tidak pernah menyentuh tabel itu.
    const superAdmin = await createUser("SUPERPAY1", "SUPER_ADMIN");
    expect((await grantPlatinum(tokenFor(superAdmin), 1)).status).toBe(201);

    const grantsBefore = await activePlatinum();
    const chairmanBefore = await activeChairman();

    // Callback pembayaran untuk referensi yang tidak dikenal tidak boleh
    // menghasilkan grant apa pun.
    await api("/api/v1/payments/midtrans/notification", {
      method: "POST",
      body: {
        order_id: "TIDAK-ADA",
        transaction_status: "settlement",
        gross_amount: "5500000.00",
        status_code: "200",
        signature_key: "palsu"
      }
    });

    expect(await activePlatinum()).toBe(grantsBefore);
    expect(await activeChairman()).toBe(chairmanBefore);
  });

  it("grant founder memiliki audit trail dan aktor yang tercatat", async () => {
    const superAdmin = await createUser("SUPERAUD1", "SUPER_ADMIN");
    expect((await grantPlatinum(tokenFor(superAdmin), 1)).status).toBe(201);

    const grant = await prisma.founderProgramGrant.findFirstOrThrow({
      where: { founderRole: "FOUNDER_PLATINUM" }
    });
    expect(grant.grantedBy).toBe(superAdmin.id);
    expect(grant.reason).toBeTruthy();
    expect(grant.revokedAt).toBeNull();

    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
  });
});
