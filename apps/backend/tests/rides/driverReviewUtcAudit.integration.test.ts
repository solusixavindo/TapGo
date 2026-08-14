import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { AdminScope, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";

/**
 * Stage R2.2A — kontrak UTC, role dari database, dan audit event scope.
 *
 * Matriks timezone dijalankan dengan mengubah TimeZone SESI database secara
 * nyata, bukan dengan mensimulasikan offset di JavaScript. Yang diuji adalah
 * apakah kontrak waktu bertahan pada setelan sesi apa pun.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;
let sequence = 0;

const ALL_SCOPES: AdminScope[] = [
  "DRIVER_APPLICATION_QUEUE_READ",
  "DRIVER_APPLICATION_CLAIM",
  "DRIVER_APPLICATION_RENEW",
  "DRIVER_APPLICATION_RELEASE",
  "DRIVER_APPLICATION_REASSIGN"
];

/** Tiga zona: UTC, positif, dan negatif. */
const TIMEZONES = ["UTC", "Asia/Jakarta", "America/New_York"] as const;

type ApiResponse = { status: number; body: { code?: string; data?: unknown } };

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
      fullName: `Utc ${role} ${sequence}`,
      phone: `08${String(200000000 + sequence)}`,
      referralCode: `UTC${String(sequence).padStart(6, "0")}`,
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

async function grantScopes(userId: string, grantorId: string, scopes: AdminScope[]) {
  for (const scope of scopes) {
    await prisma.adminScopeGrant.create({
      data: { userId, scope, grantedById: grantorId, status: "ACTIVE" }
    });
  }
}

async function createReviewer(role: UserRole = "ADMIN", scopes: AdminScope[] = ALL_SCOPES) {
  const grantor = await createUser("SUPER_ADMIN");
  const user = await createUser(role);
  await grantScopes(user.id, grantor.id, scopes);
  return { user, token: tokenFor(user), grantorId: grantor.id };
}

async function createApplication() {
  const applicant = await createUser("USER");
  return prisma.rideDriverApplication.create({
    data: {
      userId: applicant.id,
      cycleNumber: 1,
      status: "SUBMITTED",
      submittedAt: new Date()
    }
  });
}

/** Mengubah TimeZone default database sehingga sesi baru mewarisinya. */
async function setDatabaseTimezone(zone: string) {
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const database = rows[0]!.current_database;
  await prisma.$executeRawUnsafe(
    `ALTER DATABASE "${database}" SET TIME ZONE '${zone}'`
  );
  // Sesi yang sedang berjalan tidak ikut berubah, jadi diset juga agar
  // seluruh koneksi pool memakai zona yang sama.
  await prisma.$executeRawUnsafe(`SET TIME ZONE '${zone}'`);
}

const auditCount = (action: string, actorId: string) =>
  prisma.auditLog.count({ where: { action, actorId } });

describeIntegration("Stage R2.2A — UTC contract and authorization audit", () => {
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
    await setDatabaseTimezone("UTC");
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
  // A — kontrak UTC pada tiga timezone
  // =================================================================

  it("lease tetap 900 detik pada UTC, Asia/Jakarta, dan America/New_York", async () => {
    const measurements: Array<{ zone: string; leaseSeconds: number }> = [];

    for (const zone of TIMEZONES) {
      await setDatabaseTimezone(zone);
      const { token } = await createReviewer();
      const application = await createApplication();

      const claim = await api(
        `/api/v1/admin/driver-review/applications/${application.id}/claim`,
        { method: "POST", token, body: {} }
      );
      expect(claim.status, `zona ${zone}`).toBe(200);

      const rows = await prisma.$queryRaw<Array<{ lease_seconds: number }>>`
        SELECT EXTRACT(EPOCH FROM (claim_expires_at - claimed_at))::float8 AS lease_seconds
        FROM "ride_driver_applications" WHERE id = ${application.id}::uuid
      `;
      measurements.push({ zone, leaseSeconds: rows[0]!.lease_seconds });
    }

    for (const measurement of measurements) {
      expect(measurement.leaseSeconds, `zona ${measurement.zone}`).toBe(900);
    }
    await setDatabaseTimezone("UTC");
  });

  it("timestamp tersimpan adalah UTC absolut pada zona apa pun", async () => {
    const skews: Array<{ zone: string; skewSeconds: number }> = [];

    for (const zone of TIMEZONES) {
      await setDatabaseTimezone(zone);
      const { token } = await createReviewer();
      const application = await createApplication();
      await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST", token, body: {}
      });

      const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
        where: { id: application.id },
        select: { claimedAt: true }
      });
      // Prisma membaca kolom tanpa zona sebagai UTC. Bila SQL menulis UTC,
      // instant hasil bacaan harus dekat dengan waktu nyata sekarang — tanpa
      // pergeseran +7 jam (Jakarta) maupun -4/-5 jam (New York).
      skews.push({
        zone,
        skewSeconds: Math.abs((Date.now() - stored.claimedAt!.getTime()) / 1000)
      });
    }

    for (const skew of skews) {
      expect(skew.skewSeconds, `zona ${skew.zone} skew`).toBeLessThan(60);
    }
    await setDatabaseTimezone("UTC");
  });

  it("API mengembalikan ISO-8601 UTC dengan suffix Z", async () => {
    await setDatabaseTimezone("Asia/Jakarta");
    const { token } = await createReviewer();
    const application = await createApplication();

    const claim = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    const data = claim.body.data as { claimedAt?: string; claimExpiresAt?: string };
    const claimedAt = data.claimedAt ?? "";
    const claimExpiresAt = data.claimExpiresAt ?? "";

    const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(claimedAt).toMatch(isoUtc);
    expect(claimExpiresAt).toMatch(isoUtc);

    // Selisihnya tetap 900 detik ketika dibaca sebagai instant.
    const lease =
      (new Date(claimExpiresAt).getTime() - new Date(claimedAt).getTime()) / 1000;
    expect(lease).toBe(900);
    await setDatabaseTimezone("UTC");
  });

  it("claimActive dan takeover identik pada ketiga zona", async () => {
    for (const zone of TIMEZONES) {
      await setDatabaseTimezone(zone);
      const owner = await createReviewer();
      const taker = await createReviewer();
      const application = await createApplication();

      await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST", token: owner.token, body: {}
      });

      const active = await api("/api/v1/admin/driver-review/applications", {
        token: taker.token
      });
      const activeItem = (active.body.data as Array<{ id: string; claimActive: boolean }>).find(
        (row) => row.id === application.id
      );
      expect(activeItem?.claimActive, `zona ${zone} lease aktif`).toBe(true);

      // Takeover harus DITOLAK selama lease masih aktif, pada zona mana pun.
      const early = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST", token: taker.token, body: {}
      });
      expect(early.status, `zona ${zone} takeover dini`).toBe(409);

      // Setelah kedaluwarsa, takeover harus BERHASIL pada zona mana pun.
      await prisma.$executeRaw`
        UPDATE "ride_driver_applications"
        SET "claim_expires_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 minute'
        WHERE id = ${application.id}::uuid
      `;

      const expired = await api("/api/v1/admin/driver-review/applications", {
        token: taker.token
      });
      const expiredItem = (expired.body.data as Array<{ id: string; claimActive: boolean }>).find(
        (row) => row.id === application.id
      );
      expect(expiredItem?.claimActive, `zona ${zone} lease kedaluwarsa`).toBe(false);

      const takeover = await api(
        `/api/v1/admin/driver-review/applications/${application.id}/claim`,
        { method: "POST", token: taker.token, body: {} }
      );
      expect(takeover.status, `zona ${zone} takeover`).toBe(200);
    }
    await setDatabaseTimezone("UTC");
  });

  // =================================================================
  // B — role otoritatif dari database
  // =================================================================

  it("token ADMIN lama ditolak setelah role diturunkan di database", async () => {
    const { user, token } = await createReviewer("ADMIN");
    const application = await createApplication();

    // Request pertama berhasil.
    const first = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    expect(first.status).toBe(200);

    // Role diturunkan; token TIDAK diubah sama sekali.
    await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });

    const second = await api("/api/v1/admin/driver-review/applications", { token });
    expect(second.status).toBe(403);
    expect(second.body.code).toBe("DRIVER_REVIEW_ROLE_REQUIRED");
  });

  it("JWT USER dengan role ADMIN di database tetap ditolak — nol privilege escalation", async () => {
    const grantor = await createUser("SUPER_ADMIN");
    const user = await createUser("USER");
    await grantScopes(user.id, grantor.id, ALL_SCOPES);

    // Token diterbitkan dengan klaim USER.
    const staleToken = tokenFor(user);
    // Database dinaikkan menjadi ADMIN setelah token diterbitkan.
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

    const response = await api("/api/v1/admin/driver-review/applications", {
      token: staleToken
    });

    // Middleware kasar menolak berdasarkan klaim token; kenaikan role di
    // database TIDAK menaikkan kewenangan token yang sudah beredar.
    expect(response.status).toBe(403);
  });

  // =================================================================
  // C — audit event scope
  // =================================================================

  it("operasi yang diizinkan menghasilkan tepat satu admin.scope.checked", async () => {
    const { user, token } = await createReviewer();
    const application = await createApplication();

    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });

    expect(await auditCount("admin.scope.checked", user.id)).toBe(1);
    expect(await auditCount("admin.scope.denied", user.id)).toBe(0);

    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.scope.checked", actorId: user.id }
    });
    const metadata = event.metadata as Record<string, unknown>;
    expect(metadata.scope).toBe("DRIVER_APPLICATION_CLAIM");
    expect(metadata.outcome).toBe("ALLOWED");
    expect(event.entityId).toBe(application.id);
  });

  it("scope yang tidak ada menghasilkan tepat satu admin.scope.denied", async () => {
    const admin = await createUser("ADMIN");

    await api("/api/v1/admin/driver-review/applications", { token: tokenFor(admin) });

    expect(await auditCount("admin.scope.denied", admin.id)).toBe(1);
    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.scope.denied", actorId: admin.id }
    });
    const metadata = event.metadata as Record<string, unknown>;
    expect(metadata.reasonCode).toBe("SCOPE_MISSING");
    expect(metadata.outcome).toBe("DENIED");
  });

  it("scope yang dicabut menghasilkan denied dengan reason SCOPE_REVOKED", async () => {
    const { user, token } = await createReviewer();
    expect((await api("/api/v1/admin/driver-review/applications", { token })).status).toBe(200);

    await prisma.adminScopeGrant.updateMany({
      where: { userId: user.id, scope: "DRIVER_APPLICATION_QUEUE_READ" },
      data: { status: "REVOKED", revokedAt: new Date(), reasonCode: "ADMIN_ERROR" }
    });

    const after = await api("/api/v1/admin/driver-review/applications", { token });
    expect(after.status).toBe(403);

    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.scope.denied", actorId: user.id }
    });
    expect((event.metadata as Record<string, unknown>).reasonCode).toBe("SCOPE_REVOKED");
  });

  it("token ADMIN basi setelah demotion menghasilkan denied ROLE_NOT_ELIGIBLE", async () => {
    const { user, token } = await createReviewer();
    await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });

    await api("/api/v1/admin/driver-review/applications", { token });

    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.scope.denied", actorId: user.id }
    });
    expect((event.metadata as Record<string, unknown>).reasonCode).toBe("ROLE_NOT_ELIGIBLE");
  });

  it("akun non-ACTIVE menghasilkan denied ACCOUNT_INACTIVE", async () => {
    const grantor = await createUser("SUPER_ADMIN");
    const admin = await createUser("ADMIN", "SUSPENDED");
    await grantScopes(admin.id, grantor.id, ALL_SCOPES);

    await api("/api/v1/admin/driver-review/applications", { token: tokenFor(admin) });

    const event = await prisma.auditLog.findFirstOrThrow({
      where: { action: "admin.scope.denied", actorId: admin.id }
    });
    expect((event.metadata as Record<string, unknown>).reasonCode).toBe("ACCOUNT_INACTIVE");
  });

  it("metadata audit scope hanya memuat kunci yang di-allowlist", async () => {
    const { user, token } = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    const denied = await createUser("ADMIN");
    await api("/api/v1/admin/driver-review/applications", { token: tokenFor(denied) });

    const events = await prisma.auditLog.findMany({
      where: { action: { in: ["admin.scope.checked", "admin.scope.denied"] } }
    });
    expect(events.length).toBeGreaterThan(0);

    const allowed = new Set(["scope", "outcome", "reasonCode", "applicationId"]);
    for (const event of events) {
      for (const key of Object.keys(event.metadata as Record<string, unknown>)) {
        expect(allowed.has(key), `kunci tak terduga: ${key}`).toBe(true);
      }
      const serialized = JSON.stringify(event.metadata);
      for (const forbidden of ["phone", "email", "nik", "token", "password", "Error"]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
    expect(user.id).toBeTruthy();
  });

  it("wildcard tidak dapat tercatat sebagai scope yang sah", async () => {
    const events = await prisma.auditLog.findMany({
      where: { action: { in: ["admin.scope.checked", "admin.scope.denied"] } }
    });
    for (const event of events) {
      expect((event.metadata as Record<string, unknown>).scope).not.toBe("*");
    }

    // Enum database menolak wildcard, sehingga scope semacam itu tidak pernah
    // dapat menjadi grant yang kemudian tercatat sebagai sah.
    const grantor = await createUser("SUPER_ADMIN");
    const admin = await createUser("ADMIN");
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "admin_scope_grants" ("id","user_id","scope","status","granted_by_id","granted_at","created_at","updated_at")
         VALUES (gen_random_uuid(), $1::uuid, '*', 'ACTIVE', $2::uuid, now(), now(), now())`,
        admin.id,
        grantor.id
      )
    ).rejects.toThrow();
  });

  it("penolakan tidak mengubah lease dan tidak menghasilkan event ganda", async () => {
    const owner = await createReviewer();
    const outsider = await createUser("ADMIN");
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });
    const before = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });

    const denied = await api(
      `/api/v1/admin/driver-review/applications/${application.id}/claim`,
      { method: "POST", token: tokenFor(outsider), body: {} }
    );
    expect(denied.status).toBe(403);

    // Lease tidak tersentuh oleh penolakan.
    expect(
      await prisma.rideDriverApplication.findUniqueOrThrow({ where: { id: application.id } })
    ).toEqual(before);

    // Tepat satu event denied, bukan dua — hanya service yang menulis, router
    // tidak menulis event apa pun.
    expect(await auditCount("admin.scope.denied", outsider.id)).toBe(1);
    expect(await auditCount("admin.scope.checked", outsider.id)).toBe(0);
  });

  it("pembacaan antrian yang berhasil tidak menghasilkan event ALLOWED", async () => {
    const { user, token } = await createReviewer();

    await api("/api/v1/admin/driver-review/applications", { token });
    await api("/api/v1/admin/driver-review/applications", { token });

    // Polling antrian tidak boleh menenggelamkan audit.
    expect(await auditCount("admin.scope.checked", user.id)).toBe(0);
    expect(await auditCount("admin.scope.denied", user.id)).toBe(0);
  });
});
