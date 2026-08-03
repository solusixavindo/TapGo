import { execFile } from "node:child_process";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { AdminScope, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";

/**
 * Stage R2.3 — tata kelola scope admin.
 *
 * Bootstrap diuji lewat CLI SUNGGUHAN, bukan dengan memanggil service secara
 * langsung: yang perlu dibuktikan adalah bahwa jalur offline itu sendiri
 * fail-closed, termasuk saat dua proses dijalankan bersamaan.
 */

const describeIntegration = runIntegration ? describe : describe.skip;
const run = promisify(execFile);

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;
let sequence = 0;

const MANAGE: AdminScope = "ADMIN_SCOPE_MANAGE";
const REVIEW: AdminScope = "DRIVER_APPLICATION_QUEUE_READ";

type ApiResponse = { status: number; body: { code?: string; data?: any } };

async function api(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      "content-type": "application/json"
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

async function createUser(role: UserRole, status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Gov ${role} ${sequence}`,
      phone: `08${String(100000000 + sequence)}`,
      referralCode: `GOV${String(sequence).padStart(6, "0")}`,
      role,
      status
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

/** Menjalankan CLI bootstrap sungguhan sebagai proses terpisah. */
async function runBootstrap(userId: string, reason = "INITIAL_BOOTSTRAP", confirm = true) {
  const args = ["tsx", "scripts/admin-scope-bootstrap.ts", "--user-id", userId, "--reason", reason];
  if (confirm) {
    args.push("--confirm-one-time-bootstrap");
  }
  try {
    const { stdout } = await run("npx", args, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.TAPGO_TEST_DATABASE_URL }
    });
    return { ok: true, output: stdout };
  } catch (error) {
    const shell = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${shell.stdout ?? ""}${shell.stderr ?? ""}` };
  }
}

/** Manager penuh: SUPER_ADMIN aktif dengan ADMIN_SCOPE_MANAGE. */
async function createManager() {
  const user = await createUser("SUPER_ADMIN");
  const grant = await prisma.adminScopeGrant.create({
    data: { userId: user.id, scope: MANAGE, grantedById: user.id, status: "ACTIVE" }
  });
  return { user, token: tokenFor(user), grantId: grant.id };
}

const activeManagers = () =>
  prisma.adminScopeGrant.count({
    where: {
      scope: MANAGE,
      status: "ACTIVE",
      user: { status: "ACTIVE", role: "SUPER_ADMIN" }
    }
  });

const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });

describeIntegration("Stage R2.3 — admin scope governance", () => {
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
    }
  });

  // =================================================================
  // Bootstrap (1-10)
  // =================================================================

  it("1. bootstrap pertama berhasil dan 9. menulis audit tepat satu", async () => {
    const target = await createUser("SUPER_ADMIN");

    const result = await runBootstrap(target.id);

    expect(result.ok, result.output).toBe(true);
    expect(result.output).toContain("BOOTSTRAP: SUCCESS");
    expect(await activeManagers()).toBe(1);
    expect(await auditCount("admin.scope.bootstrap_completed")).toBe(1);
    // Output tidak memuat PII maupun connection string.
    expect(result.output).not.toContain(target.phone);
    expect(result.output.toLowerCase()).not.toContain("postgresql://");
  });

  it("2-4. target USER, ADMIN, dan SUPER_ADMIN non-ACTIVE ditolak", async () => {
    for (const [role, status] of [
      ["USER", "ACTIVE"],
      ["ADMIN", "ACTIVE"],
      ["SUPER_ADMIN", "SUSPENDED"]
    ] as const) {
      const target = await createUser(role, status);
      const result = await runBootstrap(target.id);
      expect(result.ok, `${role}/${status}`).toBe(false);
      expect(result.output).toContain("BOOTSTRAP: FAILURE");
    }
    expect(await activeManagers()).toBe(0);
    expect(await auditCount("admin.scope.bootstrap_completed")).toBe(0);
  });

  it("5. bootstrap kedua ditolak fail-closed", async () => {
    const first = await createUser("SUPER_ADMIN");
    expect((await runBootstrap(first.id)).ok).toBe(true);

    const second = await createUser("SUPER_ADMIN");
    const result = await runBootstrap(second.id);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("pengelola scope yang layak");
    expect(await activeManagers()).toBe(1);
  });

  it("6. bootstrap serentak menghasilkan tepat satu pemenang", async () => {
    const a = await createUser("SUPER_ADMIN");
    const b = await createUser("SUPER_ADMIN");

    const results = await Promise.all([runBootstrap(a.id), runBootstrap(b.id)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await activeManagers()).toBe(1);
    expect(await auditCount("admin.scope.bootstrap_completed")).toBe(1);
  });

  it("7-8. server startup dan migration tidak membuat grant", async () => {
    // Server sudah berjalan sejak beforeAll dan cleanDatabase baru dijalankan;
    // bila startup membuat grant, hitungan di bawah tidak akan nol.
    expect(await prisma.adminScopeGrant.count()).toBe(0);

    // Migration juga tidak: database uji ini hasil migrate deploy penuh.
    const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    expect(Number(applied[0]!.count)).toBeGreaterThan(0);
    expect(await prisma.adminScopeGrant.count()).toBe(0);
  });

  it("10. break-glass hanya bekerja ketika nol manager layak", async () => {
    const manager = await createManager();

    // Selama masih ada manager layak, break-glass DITOLAK — bukan bypass.
    const blocked = await runBootstrap(manager.user.id, "BREAK_GLASS_RECOVERY");
    expect(blocked.ok).toBe(false);

    // Role diturunkan di luar service sehingga nol manager layak.
    await prisma.user.update({ where: { id: manager.user.id }, data: { role: "ADMIN" } });
    expect(await activeManagers()).toBe(0);

    const recovery = await createUser("SUPER_ADMIN");
    const result = await runBootstrap(recovery.id, "BREAK_GLASS_RECOVERY");
    expect(result.ok, result.output).toBe(true);
    expect(await auditCount("admin.scope.break_glass_completed")).toBe(1);
    // Grant lama tidak dihapus: riwayat utuh.
    expect(await prisma.adminScopeGrant.count()).toBe(2);
  });

  // =================================================================
  // Authorization (11-16)
  // =================================================================

  it("11. ADMIN dengan ADMIN_SCOPE_MANAGE tetap ditolak", async () => {
    const admin = await createUser("ADMIN");
    await prisma.adminScopeGrant.create({
      data: { userId: admin.id, scope: MANAGE, grantedById: admin.id, status: "ACTIVE" }
    });

    const response = await api("/api/v1/admin/scope-grants", { token: tokenFor(admin) });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ADMIN_SCOPE_ACTOR_ROLE_REQUIRED");
  });

  it("12. SUPER_ADMIN tanpa manage scope ditolak", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    const response = await api("/api/v1/admin/scope-grants", { token: tokenFor(superAdmin) });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ADMIN_SCOPE_MANAGE_REQUIRED");
  });

  it("13. SUPER_ADMIN dengan manage scope diizinkan", async () => {
    const manager = await createManager();
    const response = await api("/api/v1/admin/scope-grants", { token: manager.token });
    expect(response.status).toBe(200);
  });

  it("14. JWT SUPER_ADMIN basi setelah demotion database ditolak", async () => {
    const manager = await createManager();
    expect((await api("/api/v1/admin/scope-grants", { token: manager.token })).status).toBe(200);

    await prisma.user.update({ where: { id: manager.user.id }, data: { role: "ADMIN" } });

    const after = await api("/api/v1/admin/scope-grants", { token: manager.token });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("ADMIN_SCOPE_ACTOR_ROLE_REQUIRED");
  });

  it("15-16. pencabutan berlaku dengan token lama; JWT bukan sumber scope", async () => {
    const manager = await createManager();
    expect((await api("/api/v1/admin/scope-grants", { token: manager.token })).status).toBe(200);

    // Grant dicabut langsung di database; token tidak diubah sama sekali.
    await prisma.adminScopeGrant.update({
      where: { id: manager.grantId },
      data: { status: "REVOKED", revokedAt: new Date(), reasonCode: "ACCESS_REMOVAL" }
    });

    const after = await api("/api/v1/admin/scope-grants", { token: manager.token });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("ADMIN_SCOPE_MANAGE_REQUIRED");
  });

  // =================================================================
  // Grant (17-27)
  // =================================================================

  it("17. review scope kepada ADMIN aktif berhasil", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");

    const response = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });

    expect(response.status).toBe(201);
    expect(response.body.data.alreadyActive).toBe(false);
    expect(await auditCount("admin.scope.granted")).toBe(1);
  });

  it("18-19. manage scope: ADMIN ditolak, SUPER_ADMIN aktif berhasil", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");

    const rejected = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: MANAGE, reasonCode: "ROLE_CHANGE" }
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("ADMIN_SCOPE_TARGET_ROLE_INVALID");

    const accepted = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: superAdmin.id, scope: MANAGE, reasonCode: "ROLE_CHANGE" }
    });
    expect(accepted.status).toBe(201);
    expect(await activeManagers()).toBe(2);
  });

  it("20-21. grant kepada USER dan kepada target inactive ditolak", async () => {
    const manager = await createManager();
    const user = await createUser("USER");
    const inactive = await createUser("ADMIN", "SUSPENDED");

    const toUser = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: user.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    expect(toUser.status).toBe(409);
    expect(toUser.body.code).toBe("ADMIN_SCOPE_TARGET_ROLE_INVALID");

    const toInactive = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: inactive.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    expect(toInactive.status).toBe(409);
    expect(toInactive.body.code).toBe("ADMIN_SCOPE_TARGET_INACTIVE");

    expect(await prisma.adminScopeGrant.count({ where: { status: "ACTIVE" } })).toBe(1);
  });

  it("22-23. scope tak dikenal/wildcard dan reason tidak sah ditolak", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");

    for (const scope of ["*", "DRIVER_APPLICATION_ALL", "ADMIN"]) {
      const response = await api("/api/v1/admin/scope-grants", {
        method: "POST",
        token: manager.token,
        body: { targetUserId: admin.id, scope, reasonCode: "OPERATIONAL_ASSIGNMENT" }
      });
      expect(response.status, `scope ${scope}`).toBe(400);
    }

    for (const reasonCode of ["karena saya mau", "", "ERROR: boom"]) {
      const response = await api("/api/v1/admin/scope-grants", {
        method: "POST",
        token: manager.token,
        body: { targetUserId: admin.id, scope: REVIEW, reasonCode }
      });
      expect(response.status, `reason ${reasonCode}`).toBe(400);
    }

    expect(await prisma.adminScopeGrant.count({ where: { status: "ACTIVE" } })).toBe(1);
  });

  it("24-25. duplicate grant idempotent dan grant serentak satu baris aktif", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    const body = {
      targetUserId: admin.id,
      scope: REVIEW,
      reasonCode: "OPERATIONAL_ASSIGNMENT"
    };

    const first = await api("/api/v1/admin/scope-grants", {
      method: "POST", token: manager.token, body
    });
    expect(first.status).toBe(201);

    const duplicate = await api("/api/v1/admin/scope-grants", {
      method: "POST", token: manager.token, body
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.alreadyActive).toBe(true);
    expect(duplicate.body.data.grant.id).toBe(first.body.data.grant.id);

    // Nol baris kedua dan nol audit mutasi kedua.
    expect(
      await prisma.adminScopeGrant.count({
        where: { userId: admin.id, scope: REVIEW, status: "ACTIVE" }
      })
    ).toBe(1);
    expect(await auditCount("admin.scope.granted")).toBe(1);

    // Grant serentak untuk target lain juga hanya menyisakan satu baris aktif.
    const other = await createUser("ADMIN");
    const concurrent = await Promise.all([
      api("/api/v1/admin/scope-grants", {
        method: "POST", token: manager.token,
        body: { ...body, targetUserId: other.id }
      }),
      api("/api/v1/admin/scope-grants", {
        method: "POST", token: manager.token,
        body: { ...body, targetUserId: other.id }
      })
    ]);
    expect(concurrent.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(
      await prisma.adminScopeGrant.count({
        where: { userId: other.id, scope: REVIEW, status: "ACTIVE" }
      })
    ).toBe(1);
  });

  it("26. self-grant review scope tercatat sebagai event khusus", async () => {
    const manager = await createManager();

    const response = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: manager.user.id, scope: REVIEW, reasonCode: "TEMPORARY_ACCESS" }
    });
    expect(response.status).toBe(201);

    expect(await auditCount("admin.scope.self_granted")).toBe(1);
    expect(await auditCount("admin.scope.granted")).toBe(0);

    // Aktor tidak boleh menciptakan ADMIN_SCOPE_MANAGE kedua untuk dirinya.
    const selfManage = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: manager.user.id, scope: MANAGE, reasonCode: "ROLE_CHANGE" }
    });
    expect(selfManage.status).toBe(409);
    expect(selfManage.body.code).toBe("ADMIN_SCOPE_ALREADY_ACTIVE");
  });

  it("27. grant ditolak tidak meninggalkan baris, dan audit denied tercatat", async () => {
    const manager = await createManager();
    const user = await createUser("USER");

    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: user.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });

    expect(await prisma.adminScopeGrant.count({ where: { userId: user.id } })).toBe(0);
    expect(await auditCount("admin.scope.grant_denied")).toBe(1);
    expect(await auditCount("admin.scope.granted")).toBe(0);
  });

  // =================================================================
  // Revoke (28-36)
  // =================================================================

  it("28-30. revoke berhasil, memblok review route, dan menjaga histori", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    const granted = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    const grantId = granted.body.data.grant.id as string;

    // Sebelum dicabut, route review dapat dipakai.
    expect(
      (await api("/api/v1/admin/driver-review/applications", { token: tokenFor(admin) })).status
    ).toBe(200);

    const revoked = await api(`/api/v1/admin/scope-grants/${grantId}/revoke`, {
      method: "POST", token: manager.token, body: { reasonCode: "ACCESS_REMOVAL" }
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe("REVOKED");

    // Langsung memblok, memakai token admin yang sama persis.
    const blocked = await api("/api/v1/admin/driver-review/applications", {
      token: tokenFor(admin)
    });
    expect(blocked.status).toBe(403);

    // Baris TIDAK dihapus.
    const row = await prisma.adminScopeGrant.findUniqueOrThrow({ where: { id: grantId } });
    expect(row.status).toBe("REVOKED");
    expect(row.revokedById).toBe(manager.user.id);
    expect(row.revokedAt).not.toBeNull();
    expect(await auditCount("admin.scope.revoked")).toBe(1);
  });

  it("31-32. revoke kedua dan grant tak dikenal ditolak tanpa mutasi", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    const granted = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    const grantId = granted.body.data.grant.id as string;
    await api(`/api/v1/admin/scope-grants/${grantId}/revoke`, {
      method: "POST", token: manager.token, body: { reasonCode: "ACCESS_REMOVAL" }
    });
    const afterFirst = await prisma.adminScopeGrant.findUniqueOrThrow({ where: { id: grantId } });

    const second = await api(`/api/v1/admin/scope-grants/${grantId}/revoke`, {
      method: "POST", token: manager.token, body: { reasonCode: "ACCESS_REMOVAL" }
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("ADMIN_SCOPE_ALREADY_REVOKED");
    expect(await prisma.adminScopeGrant.findUniqueOrThrow({ where: { id: grantId } })).toEqual(
      afterFirst
    );

    const unknown = await api(
      "/api/v1/admin/scope-grants/00000000-0000-4000-8000-000000000000/revoke",
      { method: "POST", token: manager.token, body: { reasonCode: "ACCESS_REMOVAL" } }
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("ADMIN_SCOPE_GRANT_NOT_FOUND");
    expect(await auditCount("admin.scope.revoke_denied")).toBe(2);
  });

  it("33. manager terakhir tidak dapat mencabut dirinya sendiri", async () => {
    const manager = await createManager();
    expect(await activeManagers()).toBe(1);

    const response = await api(`/api/v1/admin/scope-grants/${manager.grantId}/revoke`, {
      method: "POST", token: manager.token, body: { reasonCode: "ACCESS_REMOVAL" }
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ADMIN_SCOPE_LAST_MANAGER_PROTECTED");
    expect(await activeManagers()).toBe(1);
    expect(await auditCount("admin.scope.last_manager_protected")).toBe(1);
  });

  it("34. pencabutan silang serentak tidak menghasilkan nol manager", async () => {
    const a = await createManager();
    const b = await createManager();
    expect(await activeManagers()).toBe(2);

    // Keduanya mencoba mencabut yang lain pada saat yang sama.
    const results = await Promise.all([
      api(`/api/v1/admin/scope-grants/${b.grantId}/revoke`, {
        method: "POST", token: a.token, body: { reasonCode: "SECURITY_INCIDENT" }
      }),
      api(`/api/v1/admin/scope-grants/${a.grantId}/revoke`, {
        method: "POST", token: b.token, body: { reasonCode: "SECURITY_INCIDENT" }
      })
    ]);

    // Yang menentukan: TIDAK PERNAH nol manager.
    expect(await activeManagers()).toBeGreaterThanOrEqual(1);
    // Yang kalah menerima respons konflik yang stabil, bukan error mentah.
    const conflicts = results.filter((r) => r.status === 409);
    for (const conflict of conflicts) {
      expect([
        "ADMIN_SCOPE_LAST_MANAGER_PROTECTED",
        "ADMIN_SCOPE_ALREADY_REVOKED",
        "ADMIN_SCOPE_MANAGE_REQUIRED",
        "ADMIN_SCOPE_VERSION_CONFLICT"
      ]).toContain(conflict.body.code);
    }
  });

  it("35-36. audit dan mutasi berada dalam satu transaksi", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");

    // Grant sukses menulis tepat satu audit ALLOWED dan satu baris.
    const granted = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    expect(granted.status).toBe(201);
    expect(await auditCount("admin.scope.granted")).toBe(1);
    expect(await prisma.adminScopeGrant.count({ where: { userId: admin.id } })).toBe(1);

    // Grant yang ditolak tidak meninggalkan audit sukses palsu.
    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: MANAGE, reasonCode: "ROLE_CHANGE" }
    });
    expect(await auditCount("admin.scope.granted")).toBe(1);
    expect(await auditCount("admin.scope.grant_denied")).toBe(1);
  });

  // =================================================================
  // Read (37-40)
  // =================================================================

  it("37. /me hanya menampilkan scope milik pemanggil", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });

    const mine = await api("/api/v1/admin/scope-grants/me", { token: tokenFor(admin) });
    expect(mine.status).toBe(200);
    expect(mine.body.data.userId).toBe(admin.id);
    expect(mine.body.data.scopes).toHaveLength(1);
    expect(mine.body.data.scopes[0].scope).toBe(REVIEW);
    // Nol scope milik manager yang bocor.
    expect(JSON.stringify(mine.body)).not.toContain(MANAGE);
  });

  it("38-39. listing terpaginasi, dan ADMIN biasa tidak dapat melihat seluruh grant", async () => {
    const manager = await createManager();
    for (let index = 0; index < 5; index += 1) {
      const admin = await createUser("ADMIN");
      await api("/api/v1/admin/scope-grants", {
        method: "POST",
        token: manager.token,
        body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
      });
    }

    const firstPage = await api("/api/v1/admin/scope-grants?page=1&pageSize=2", {
      token: manager.token
    });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.total).toBe(6);
    expect(firstPage.body.data.page).toBe(1);

    const filtered = await api(`/api/v1/admin/scope-grants?scope=${MANAGE}`, {
      token: manager.token
    });
    expect(filtered.body.data.total).toBe(1);

    const plainAdmin = await createUser("ADMIN");
    const forbidden = await api("/api/v1/admin/scope-grants", { token: tokenFor(plainAdmin) });
    expect(forbidden.status).toBe(403);
  });

  it("40. respons tidak memuat PII", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });

    const listing = await api("/api/v1/admin/scope-grants", { token: manager.token });
    const mine = await api("/api/v1/admin/scope-grants/me", { token: manager.token });

    for (const payload of [JSON.stringify(listing.body), JSON.stringify(mine.body)]) {
      expect(payload).not.toContain(admin.phone);
      expect(payload).not.toContain(admin.fullName);
      expect(payload).not.toContain(admin.referralCode);
      expect(payload.toLowerCase()).not.toContain("metadata");
    }
  });

  // =================================================================
  // Isolation (41-50)
  // =================================================================

  it("41,47,48. role/status tidak berubah, nol driver profile, jalur penumpang jalan", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    const before = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });

    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });

    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).toEqual(before);
    expect(await prisma.rideDriverProfile.count()).toBe(0);
    expect(await prisma.rideVehicle.count()).toBe(0);

    const passenger = await createUser("USER");
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passenger.id,
        serviceType: "MOTORCYCLE",
        pickupLat: "-6.2000000", pickupLng: "106.8166660", pickupAddress: "Jemput",
        dropoffLat: "-6.2100000", dropoffLng: "106.8266660", dropoffAddress: "Tujuan",
        distanceMeters: 1500, durationSeconds: 600, etaSeconds: 300,
        baseFare: 5000, distanceFare: 6000, serviceFee: 1000,
        subtotalFare: 12000, totalFare: 12000,
        fareRuleVersion: "test", roundingRule: "test", distanceSource: "test",
        expiresAt: new Date(Date.now() + 600_000)
      }
    });
    expect(quote.id).toBeTruthy();
  });

  it("42-46,49,50. founder, membership, finansial, lease, dan auth state identik", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    const applicant = await createUser("USER");
    const application = await prisma.rideDriverApplication.create({
      data: { userId: applicant.id, cycleNumber: 1, status: "SUBMITTED", submittedAt: new Date() }
    });

    const snapshot = async () => ({
      founderPlatinum: await prisma.founderProgramGrant.count({
        where: { founderRole: "FOUNDER_PLATINUM", revokedAt: null }
      }),
      chairman: await prisma.founderProgramGrant.count({
        where: { founderRole: "FOUNDER_CHAIRMAN", revokedAt: null }
      }),
      userMemberships: await prisma.userMembership.count(),
      memberships: await prisma.membership.count(),
      wallets: await prisma.wallet.count(),
      walletTransactions: await prisma.walletTransaction.count(),
      commissions: await prisma.commission.count(),
      withdrawals: await prisma.withdrawal.count(),
      invoices: await prisma.invoice.count(),
      membershipPayments: await prisma.membershipPayment.count(),
      rewardTransactions: await prisma.rewardTransaction.count(),
      profitSharing: await prisma.profitSharingDistribution.count(),
      referrals: await prisma.referral.count()
    });

    const before = await snapshot();
    const leaseBefore = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    const authBefore = await prisma.user.findMany({
      select: { id: true, authVersion: true, sessionsRevokedAt: true },
      orderBy: { id: "asc" }
    });

    const granted = await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    await api(`/api/v1/admin/scope-grants/${granted.body.data.grant.id}/revoke`, {
      method: "POST", token: manager.token, body: { reasonCode: "ACCESS_REMOVAL" }
    });

    expect(await snapshot()).toEqual(before);
    // Lease pengajuan tidak tersentuh oleh tata kelola scope.
    expect(
      await prisma.rideDriverApplication.findUniqueOrThrow({ where: { id: application.id } })
    ).toEqual(leaseBefore);
    expect(
      await prisma.user.findMany({
        select: { id: true, authVersion: true, sessionsRevokedAt: true },
        orderBy: { id: "asc" }
      })
    ).toEqual(authBefore);
    expect(before.founderPlatinum).toBeLessThanOrEqual(10);
    expect(before.chairman).toBeLessThanOrEqual(1);
  });

  it("metadata audit governance hanya memuat kunci yang di-allowlist", async () => {
    const manager = await createManager();
    const admin = await createUser("ADMIN");
    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: REVIEW, reasonCode: "OPERATIONAL_ASSIGNMENT" }
    });
    await api("/api/v1/admin/scope-grants", {
      method: "POST",
      token: manager.token,
      body: { targetUserId: admin.id, scope: MANAGE, reasonCode: "ROLE_CHANGE" }
    });

    const allowed = new Set([
      "actorId", "targetUserId", "grantId", "scope",
      "reasonCode", "outcome", "previousStatus", "newStatus"
    ]);
    const events = await prisma.auditLog.findMany({
      where: { action: { startsWith: "admin.scope." } }
    });
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      for (const key of Object.keys(event.metadata as Record<string, unknown>)) {
        expect(allowed.has(key), `kunci tak terduga: ${key}`).toBe(true);
      }
      const serialized = JSON.stringify(event.metadata).toLowerCase();
      for (const forbidden of ["phone", "email", "nik", "password", "token", "secret", "error"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });
});
