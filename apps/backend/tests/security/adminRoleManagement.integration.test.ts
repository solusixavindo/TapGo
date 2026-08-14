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

/**
 * Pengelolaan role oleh pemilik sistem.
 *
 * Inilah yang membedakan SUPER_ADMIN_VIP dari SUPER_ADMIN: hanya VIP yang boleh
 * mengangkat, menurunkan, dan mengganti role ADMIN maupun SUPER_ADMIN.
 *
 * Tiga hal yang paling berbahaya bila gagal, dan karena itu diuji lebih dulu:
 * 1. SUPER_ADMIN biasa tidak boleh bisa mengubah role siapa pun — kalau bisa,
 *    seluruh pemisahan ini tidak ada artinya.
 * 2. Role puncak tidak boleh bisa diberikan lewat HTTP. Kalau bisa, siapa pun
 *    yang berhasil menjadi VIP dapat mencetak VIP lain tanpa akses server.
 * 3. Penurunan role harus berlaku SEKETIKA. Token berumur 15 menit dan membawa
 *    klaim role, jadi tanpa pencabutan sesi, admin yang diturunkan tetap
 *    memegang kewenangan lamanya.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;

const ROLES_PATH = "/api/v1/admin/roles";
const assignPath = (userId: string) => `${ROLES_PATH}/${userId}`;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Admin role management", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-admin-role-management";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-admin-role-management";

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
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  // --- Batas antara VIP dan SUPER_ADMIN ------------------------------------

  it("menolak SUPER_ADMIN biasa mengubah role siapa pun", async () => {
    const superAdmin = await createUser("ROLESA", "SUPER_ADMIN");
    const target = await createUser("ROLETGT", "USER");

    const response = await assign(superAdmin, target.id, "ADMIN");

    expect(response.status).toBe(403);
    await expectRole(target.id, "USER");
  });

  it("menolak SUPER_ADMIN biasa membaca daftar role", async () => {
    const superAdmin = await createUser("ROLESA2", "SUPER_ADMIN");
    const response = await fetch(`${baseUrl}${ROLES_PATH}`, {
      headers: { authorization: `Bearer ${tokenFor(superAdmin)}` }
    });
    expect(response.status).toBe(403);
  });

  it("menolak ADMIN dan pengguna biasa", async () => {
    const admin = await createUser("ROLEADM", "ADMIN");
    const user = await createUser("ROLEUSR", "USER");
    const target = await createUser("ROLETGT2", "USER");

    expect((await assign(admin, target.id, "ADMIN")).status).toBe(403);
    expect((await assign(user, target.id, "ADMIN")).status).toBe(403);
    await expectRole(target.id, "USER");
  });

  it("menolak permintaan tanpa token", async () => {
    const target = await createUser("ROLETGT3", "USER");

    const response = await fetch(`${baseUrl}${assignPath(target.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "ADMIN", reasonCode: "PROMOTION" })
    });

    expect(response.status).toBe(401);
    await expectRole(target.id, "USER");
  });

  // --- Role puncak tidak pernah lewat HTTP ---------------------------------

  it("menolak pemberian role puncak lewat HTTP", async () => {
    const owner = await createUser("ROLEVIP", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT4", "USER");

    const response = await assign(owner, target.id, "SUPER_ADMIN_VIP" as UserRole);

    // Ditolak validator sebelum menyentuh service: 400, bukan 403.
    expect(response.status).toBe(400);
    await expectRole(target.id, "USER");
  });

  it("menolak mengubah role sesama akun puncak", async () => {
    const owner = await createUser("ROLEVIP2", "SUPER_ADMIN_VIP");
    const peer = await createUser("ROLEVIP3", "SUPER_ADMIN_VIP");

    const response = await assign(owner, peer.id, "ADMIN");

    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("ADMIN_ROLE_TARGET_PROTECTED");
    await expectRole(peer.id, "SUPER_ADMIN_VIP");
  });

  it("menolak pemilik mengubah role dirinya sendiri", async () => {
    const owner = await createUser("ROLEVIP4", "SUPER_ADMIN_VIP");

    const response = await assign(owner, owner.id, "ADMIN");

    // Kalau ini lolos, pemilik dapat mengunci dirinya keluar dan sistem
    // kehilangan pemegang puncak terakhirnya.
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("ADMIN_ROLE_SELF_CHANGE_FORBIDDEN");
    await expectRole(owner.id, "SUPER_ADMIN_VIP");
  });

  // --- Yang memang boleh ---------------------------------------------------

  it("mengangkat pengguna biasa menjadi ADMIN", async () => {
    const owner = await createUser("ROLEVIP5", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT5", "USER");

    const response = await assign(owner, target.id, "ADMIN", "NEW_ADMIN_ASSIGNMENT");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { role: string; previousRole: string } };
    expect(body.data.role).toBe("ADMIN");
    expect(body.data.previousRole).toBe("USER");
    await expectRole(target.id, "ADMIN");
  });

  it("menaikkan ADMIN menjadi SUPER_ADMIN dan menurunkannya kembali", async () => {
    const owner = await createUser("ROLEVIP6", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT6", "ADMIN");

    expect((await assign(owner, target.id, "SUPER_ADMIN", "PROMOTION")).status).toBe(200);
    await expectRole(target.id, "SUPER_ADMIN");

    expect((await assign(owner, target.id, "ADMIN", "DEMOTION")).status).toBe(200);
    await expectRole(target.id, "ADMIN");
  });

  it("menurunkan admin menjadi pengguna biasa", async () => {
    const owner = await createUser("ROLEVIP7", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT7", "ADMIN");

    expect((await assign(owner, target.id, "USER", "OFFBOARDING")).status).toBe(200);
    await expectRole(target.id, "USER");
  });

  // --- Perubahan berlaku seketika ------------------------------------------

  it("mencabut sesi target sehingga penurunan role berlaku seketika", async () => {
    const owner = await createUser("ROLEVIP8", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT8", "ADMIN");

    // Token yang sah SEBELUM penurunan, membawa authVersion saat ini.
    const before = tokenFor(target, 0);
    const stillWorks = await fetch(`${baseUrl}/api/v1/admin/members`, {
      headers: { authorization: `Bearer ${before}` }
    });
    expect(stillWorks.status).toBeLessThan(400);

    expect((await assign(owner, target.id, "USER", "ACCESS_REMOVAL")).status).toBe(200);

    // Token lama harus gugur SEKARANG, bukan setelah 15 menit.
    const afterDemotion = await fetch(`${baseUrl}/api/v1/admin/members`, {
      headers: { authorization: `Bearer ${before}` }
    });
    expect(afterDemotion.status).toBe(401);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { authVersion: true, sessionsRevokedAt: true }
    });
    expect(stored.authVersion).toBe(1);
    expect(stored.sessionsRevokedAt).not.toBeNull();
  });

  // --- Penjagaan terhadap tata kelola scope ---------------------------------

  it("menolak menurunkan SUPER_ADMIN yang masih memegang pengelolaan scope", async () => {
    const owner = await createUser("ROLEVIP9", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT9", "SUPER_ADMIN");
    await prisma.adminScopeGrant.create({
      data: {
        userId: target.id,
        scope: "ADMIN_SCOPE_MANAGE",
        status: "ACTIVE",
        grantedById: owner.id
      }
    });

    const response = await assign(owner, target.id, "ADMIN", "DEMOTION");

    // Kalau lolos, grant-nya tetap ACTIVE tetapi tidak lagi dihitung layak,
    // dan sistem bisa diam-diam kehabisan pengelola scope.
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("ADMIN_ROLE_SCOPE_STILL_HELD");
    await expectRole(target.id, "SUPER_ADMIN");
  });

  // --- Penolakan lain -------------------------------------------------------

  it("menolak kode alasan di luar daftar", async () => {
    const owner = await createUser("ROLEVIP10", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT10", "USER");

    const response = await fetch(`${baseUrl}${assignPath(target.id)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${tokenFor(owner)}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "ADMIN", reasonCode: "karena-saya-mau" })
    });

    expect(response.status).toBe(400);
    await expectRole(target.id, "USER");
  });

  it("menolak role yang tidak berubah dan akun yang tidak ada", async () => {
    const owner = await createUser("ROLEVIP11", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT11", "ADMIN");

    const unchanged = await assign(owner, target.id, "ADMIN");
    expect(unchanged.status).toBe(409);
    expect(await codeOf(unchanged)).toBe("ADMIN_ROLE_UNCHANGED");

    const missing = await assign(owner, "00000000-0000-4000-8000-000000000000", "ADMIN");
    expect(missing.status).toBe(404);
  });

  it("menolak mengubah role akun driver", async () => {
    const owner = await createUser("ROLEVIP12", "SUPER_ADMIN_VIP");
    const driver = await createUser("ROLEDRV", "DRIVER");

    const response = await assign(owner, driver.id, "ADMIN");

    // Kewenangan driver berasal dari profil driver, bukan role. Menukarnya di
    // sini akan mengaburkan dua jalur yang sengaja terpisah.
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("ADMIN_ROLE_DRIVER_NOT_ELIGIBLE");
    await expectRole(driver.id, "DRIVER");
  });

  // --- Jejak audit ----------------------------------------------------------

  it("mencatat setiap perubahan role beserta alasannya", async () => {
    const owner = await createUser("ROLEVIP13", "SUPER_ADMIN_VIP");
    const target = await createUser("ROLETGT13", "USER");

    await assign(owner, target.id, "ADMIN", "NEW_ADMIN_ASSIGNMENT");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "ADMIN_ROLE_ASSIGNED", entityId: target.id }
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(audit.actorId).toBe(owner.id);
    expect(metadata.previousRole).toBe("USER");
    expect(metadata.newRole).toBe("ADMIN");
    expect(metadata.reasonCode).toBe("NEW_ADMIN_ASSIGNMENT");
    expect(metadata.sessionsRevoked).toBe(true);
  });

  it("tetap mencatat penolakan walau transaksinya dibatalkan", async () => {
    const owner = await createUser("ROLEVIP14", "SUPER_ADMIN_VIP");
    const peer = await createUser("ROLEVIP15", "SUPER_ADMIN_VIP");

    await assign(owner, peer.id, "ADMIN");

    // Penolakan ditulis lewat koneksi terpisah. Kalau ikut transaksi yang
    // dibatalkan, justru kejadian paling perlu dicatat yang hilang.
    const denied = await prisma.auditLog.findFirst({
      where: { action: "ADMIN_ROLE_ASSIGN_DENIED", entityId: peer.id }
    });
    expect(denied).not.toBeNull();
    expect(denied!.actorId).toBe(owner.id);
  });

  // --- Daftar dan pencarian -------------------------------------------------

  it("menampilkan daftar admin beserta penanda pemegang scope", async () => {
    const owner = await createUser("ROLEVIP16", "SUPER_ADMIN_VIP");
    const superAdmin = await createUser("ROLESA3", "SUPER_ADMIN");
    await createUser("ROLEADM2", "ADMIN");
    await createUser("ROLEPLAIN", "USER");
    await prisma.adminScopeGrant.create({
      data: {
        userId: superAdmin.id,
        scope: "ADMIN_SCOPE_MANAGE",
        status: "ACTIVE",
        grantedById: owner.id
      }
    });

    const response = await fetch(`${baseUrl}${ROLES_PATH}`, {
      headers: { authorization: `Bearer ${tokenFor(owner)}` }
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: Array<{ id: string; role: string; holdsScopeManage: boolean }>;
    };
    // Hanya akun administratif; pengguna biasa tidak ikut.
    expect(body.data).toHaveLength(3);
    expect(body.data.map((item) => item.role).sort()).toEqual([
      "ADMIN",
      "SUPER_ADMIN",
      "SUPER_ADMIN_VIP"
    ]);
    expect(body.data.find((item) => item.id === superAdmin.id)?.holdsScopeManage).toBe(true);
    expect(body.data.find((item) => item.id === owner.id)?.holdsScopeManage).toBe(false);
  });

  it("mencari kandidat tanpa membuka seluruh daftar pengguna", async () => {
    const owner = await createUser("ROLEVIP17", "SUPER_ADMIN_VIP");
    const candidate = await createUser("KANDIDATCARI", "USER");

    const found = await fetch(`${baseUrl}${ROLES_PATH}/candidates?q=KANDIDATCARI`, {
      headers: { authorization: `Bearer ${tokenFor(owner)}` }
    });
    expect(found.status).toBe(200);
    const body = (await found.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((item) => item.id === candidate.id)).toBe(true);

    // Kueri terlalu pendek ditolak validator, bukan dijawab dengan dump user.
    const tooShort = await fetch(`${baseUrl}${ROLES_PATH}/candidates?q=ab`, {
      headers: { authorization: `Bearer ${tokenFor(owner)}` }
    });
    expect(tooShort.status).toBe(400);
  });
});

async function assign(
  actor: User,
  targetUserId: string,
  role: UserRole,
  reasonCode = "RESPONSIBILITY_CHANGE"
) {
  return fetch(`${baseUrl}${assignPath(targetUserId)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${tokenFor(actor)}`, "content-type": "application/json" },
    body: JSON.stringify({ role, reasonCode })
  });
}

async function expectRole(userId: string, role: UserRole) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true }
  });
  expect(user.role).toBe(role);
}

async function codeOf(response: Response) {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

function tokenFor(user: User, authVersion = 0) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
    authVersion
  });
}

async function createUser(label: string, role: UserRole): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${label}`,
      phone: `+6286${String(sequence).padStart(8, "0")}`,
      referralCode: `${label}${sequence}`.slice(0, 24),
      role,
      status: "ACTIVE",
      membershipId: basic.id
    }
  });
}
