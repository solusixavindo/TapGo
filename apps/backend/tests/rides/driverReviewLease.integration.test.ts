import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { AdminScope, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";

/**
 * Stage R2.2 / 5.14C — otorisasi review driver dan claim/lease.
 *
 * Seluruh konkurensi diuji pada PostgreSQL nyata dengan permintaan HTTP
 * paralel — bukan timing Promise semu maupun mock database.
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
      fullName: `Review ${role} ${sequence}`,
      phone: `08${String(300000000 + sequence)}`,
      referralCode: `RVW${String(sequence).padStart(6, "0")}`,
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

/** Admin lengkap: ACTIVE, role admin, seluruh scope aktif. */
async function createReviewer(role: UserRole = "ADMIN", scopes: AdminScope[] = ALL_SCOPES) {
  const grantor = await createUser("SUPER_ADMIN");
  const user = await createUser(role);
  await grantScopes(user.id, grantor.id, scopes);
  return { user, token: tokenFor(user) };
}

async function createApplication(status: "SUBMITTED" | "DRAFT" = "SUBMITTED") {
  const applicant = await createUser("USER");
  return prisma.rideDriverApplication.create({
    data: {
      userId: applicant.id,
      cycleNumber: 1,
      status,
      ...(status === "SUBMITTED" ? { submittedAt: new Date() } : {})
    }
  });
}

const auditCount = (action: string, entityId: string) =>
  prisma.auditLog.count({ where: { action, entityId } });

describeIntegration("Stage R2.2 — driver review scope and lease", () => {
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
  // Authorization (1-10)
  // =================================================================

  it("1. USER tanpa scope ditolak", async () => {
    const user = await createUser("USER");
    const response = await api("/api/v1/admin/driver-review/applications", {
      token: tokenFor(user)
    });
    expect(response.status).toBe(403);
  });

  it("2. USER DENGAN scope tetap ditolak", async () => {
    const grantor = await createUser("SUPER_ADMIN");
    const user = await createUser("USER");
    await grantScopes(user.id, grantor.id, ALL_SCOPES);

    const response = await api("/api/v1/admin/driver-review/applications", {
      token: tokenFor(user)
    });

    // Role bukan ADMIN/SUPER_ADMIN — scope tidak menambal itu.
    expect(response.status).toBe(403);
  });

  it("3. ADMIN tanpa scope ditolak", async () => {
    const admin = await createUser("ADMIN");
    const response = await api("/api/v1/admin/driver-review/applications", {
      token: tokenFor(admin)
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("DRIVER_REVIEW_SCOPE_REQUIRED");
  });

  it("4. SUPER_ADMIN tanpa scope ditolak — tidak ada bypass role", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    const response = await api("/api/v1/admin/driver-review/applications", {
      token: tokenFor(superAdmin)
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("DRIVER_REVIEW_SCOPE_REQUIRED");
  });

  it("5. ADMIN dengan scope aktif diizinkan", async () => {
    const { token } = await createReviewer("ADMIN");
    const response = await api("/api/v1/admin/driver-review/applications", { token });
    expect(response.status).toBe(200);
  });

  it("6. SUPER_ADMIN dengan scope aktif diizinkan", async () => {
    const { token } = await createReviewer("SUPER_ADMIN");
    const response = await api("/api/v1/admin/driver-review/applications", { token });
    expect(response.status).toBe(200);
  });

  it("7. akun non-ACTIVE ditolak meski punya scope", async () => {
    const grantor = await createUser("SUPER_ADMIN");
    const admin = await createUser("ADMIN", "SUSPENDED");
    await grantScopes(admin.id, grantor.id, ALL_SCOPES);

    const response = await api("/api/v1/admin/driver-review/applications", {
      token: tokenFor(admin)
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("DRIVER_REVIEW_ACCOUNT_INACTIVE");
  });

  it("8. pencabutan scope berlaku SEGERA dengan access token lama", async () => {
    const { user, token } = await createReviewer("ADMIN");
    expect((await api("/api/v1/admin/driver-review/applications", { token })).status).toBe(200);

    // Token tidak diubah sama sekali — hanya grant di database yang dicabut.
    await prisma.adminScopeGrant.updateMany({
      where: { userId: user.id, scope: "DRIVER_APPLICATION_QUEUE_READ" },
      data: { status: "REVOKED", revokedAt: new Date(), reasonCode: "ADMIN_ERROR" }
    });

    const after = await api("/api/v1/admin/driver-review/applications", { token });
    expect(after.status).toBe(403);
    expect(after.body.code).toBe("DRIVER_REVIEW_SCOPE_REQUIRED");
  });

  it("9. scope yang berbeda tidak memberi akses lintas operasi", async () => {
    const { token } = await createReviewer("ADMIN", ["DRIVER_APPLICATION_QUEUE_READ"]);
    const application = await createApplication();

    expect((await api("/api/v1/admin/driver-review/applications", { token })).status).toBe(200);

    const claim = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST",
      token,
      body: {}
    });
    expect(claim.status).toBe(403);
    expect(claim.body.code).toBe("DRIVER_REVIEW_SCOPE_REQUIRED");
  });

  it("10. scope tak dikenal dan wildcard mustahil tersimpan", async () => {
    const grantor = await createUser("SUPER_ADMIN");
    const admin = await createUser("ADMIN");

    // Enum database menolak nilai di luar daftar — wildcard tidak dapat
    // direpresentasikan sama sekali.
    for (const bogus of ["*", "DRIVER_APPLICATION_ALL", "ADMIN"]) {
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "admin_scope_grants" ("id","user_id","scope","status","granted_by_id","granted_at","created_at","updated_at")
           VALUES (gen_random_uuid(), $1::uuid, '${bogus}', 'ACTIVE', $2::uuid, now(), now(), now())`,
          admin.id,
          grantor.id
        )
      ).rejects.toThrow();
    }
    expect(await prisma.adminScopeGrant.count()).toBe(0);
  });

  // =================================================================
  // Lease (11-30)
  // =================================================================

  it("11. claim pertama berhasil", async () => {
    const { user, token } = await createReviewer();
    const application = await createApplication();

    const response = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST",
      token,
      body: {}
    });

    expect(response.status).toBe(200);
    const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect(stored.claimedById).toBe(user.id);
    expect(stored.status).toBe("UNDER_REVIEW");
    expect(stored.version).toBe(application.version + 1);
  });

  it("12. claim serentak menghasilkan tepat satu pemenang", async () => {
    const a = await createReviewer();
    const b = await createReviewer();
    const application = await createApplication();

    const [first, second] = await Promise.all([
      api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST",
        token: a.token,
        body: {}
      }),
      api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST",
        token: b.token,
        body: {}
      })
    ]);

    const statuses = [first.status, second.status];
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(1);

    const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect([a.user.id, b.user.id]).toContain(stored.claimedById);
    expect(await auditCount("driver.application.claimed", application.id)).toBe(1);
  });

  it("13-14. claim memakai waktu database dan lease tepat 15 menit", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST",
      token,
      body: {}
    });

    const rows = await prisma.$queryRaw<Array<{ diff_seconds: number; skew_seconds: number }>>`
      SELECT EXTRACT(EPOCH FROM (claim_expires_at - claimed_at))::float8 AS diff_seconds,
             EXTRACT(EPOCH FROM (now() - claimed_at))::float8 AS skew_seconds
      FROM "ride_driver_applications" WHERE id = ${application.id}::uuid
    `;

    // Selisih dihitung database, jadi harus persis 900 detik.
    expect(rows[0]!.diff_seconds).toBe(900);
    // claimed_at berasal dari now() database, bukan jam Node.
    expect(Math.abs(rows[0]!.skew_seconds)).toBeLessThan(10);
  });

  it("15. current claimant dapat renew", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    const before = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });

    const renew = await api(`/api/v1/admin/driver-review/applications/${application.id}/renew`, {
      method: "POST", token
    });
    expect(renew.status).toBe(200);

    const after = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    // claimedAt awal TIDAK diubah diam-diam; hanya batas lease yang bergerak.
    expect(after.claimedAt!.getTime()).toBe(before.claimedAt!.getTime());
    expect(after.claimExpiresAt!.getTime()).toBeGreaterThanOrEqual(before.claimExpiresAt!.getTime());
    expect(after.version).toBe(before.version + 1);
  });

  it("16. admin lain tidak dapat renew", async () => {
    const owner = await createReviewer();
    const other = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });

    const response = await api(`/api/v1/admin/driver-review/applications/${application.id}/renew`, {
      method: "POST", token: other.token
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DRIVER_REVIEW_NOT_CLAIM_OWNER");
  });

  it("17. claim yang sudah expired tidak dapat di-renew", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    await prisma.$executeRaw`
      UPDATE "ride_driver_applications"
      SET "claim_expires_at" = now() - interval '1 minute'
      WHERE id = ${application.id}::uuid
    `;

    const response = await api(`/api/v1/admin/driver-review/applications/${application.id}/renew`, {
      method: "POST", token
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DRIVER_REVIEW_CLAIM_EXPIRED");
  });

  it("18-19. claimant dapat release, dan reason code dibatasi", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });

    const invalid = await api(`/api/v1/admin/driver-review/applications/${application.id}/release`, {
      method: "POST", token, body: { reasonCode: "APA SAJA TEKS BEBAS" }
    });
    expect(invalid.status).toBe(400);

    const valid = await api(`/api/v1/admin/driver-review/applications/${application.id}/release`, {
      method: "POST", token, body: { reasonCode: "REVIEW_POSTPONED" }
    });
    expect(valid.status).toBe(200);

    const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect(stored.claimedById).toBeNull();
    expect(stored.claimedAt).toBeNull();
    expect(stored.claimExpiresAt).toBeNull();
    expect(stored.releaseReasonCode).toBe("REVIEW_POSTPONED");
    expect(stored.status).toBe("SUBMITTED");
  });

  it("20. claim expired dapat diambil alih admin lain", async () => {
    const owner = await createReviewer();
    const taker = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });
    await prisma.$executeRaw`
      UPDATE "ride_driver_applications"
      SET "claim_expires_at" = now() - interval '1 minute'
      WHERE id = ${application.id}::uuid
    `;

    const response = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: taker.token, body: {}
    });
    expect(response.status).toBe(200);

    const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect(stored.claimedById).toBe(taker.user.id);
    expect(await auditCount("driver.application.claim_expired_takeover", application.id)).toBe(1);
  });

  it("21. takeover serentak atas lease expired menghasilkan satu pemenang", async () => {
    const owner = await createReviewer();
    const a = await createReviewer();
    const b = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });
    await prisma.$executeRaw`
      UPDATE "ride_driver_applications"
      SET "claim_expires_at" = now() - interval '1 minute'
      WHERE id = ${application.id}::uuid
    `;

    const results = await Promise.all([
      api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST", token: a.token, body: {}
      }),
      api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
        method: "POST", token: b.token, body: {}
      })
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect([a.user.id, b.user.id]).toContain(stored.claimedById);
  });

  it("22. reassign tanpa scope ditolak", async () => {
    const actor = await createReviewer("ADMIN", [
      "DRIVER_APPLICATION_QUEUE_READ",
      "DRIVER_APPLICATION_CLAIM"
    ]);
    const target = await createReviewer();
    const application = await createApplication();

    const response = await api(
      `/api/v1/admin/driver-review/applications/${application.id}/reassign`,
      {
        method: "POST",
        token: actor.token,
        body: { targetUserId: target.user.id, reasonCode: "WORKLOAD_BALANCING" }
      }
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("DRIVER_REVIEW_SCOPE_REQUIRED");
  });

  it("23. reassign dengan scope berhasil dan atomik", async () => {
    const actor = await createReviewer();
    const owner = await createReviewer();
    const target = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });

    const response = await api(
      `/api/v1/admin/driver-review/applications/${application.id}/reassign`,
      {
        method: "POST",
        token: actor.token,
        body: { targetUserId: target.user.id, reasonCode: "ESCALATION" }
      }
    );
    expect(response.status).toBe(200);

    const stored = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect(stored.claimedById).toBe(target.user.id);
    expect(stored.claimExpiresAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "driver.application.claim_reassigned", entityId: application.id }
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(audit.actorId).toBe(actor.user.id);
    expect(metadata.previousClaimantId).toBe(owner.user.id);
    expect(metadata.newClaimantId).toBe(target.user.id);
    expect(metadata.reasonCode).toBe("ESCALATION");
  });

  it("24. target reviewer non-ACTIVE ditolak", async () => {
    const actor = await createReviewer();
    const grantor = await createUser("SUPER_ADMIN");
    const target = await createUser("ADMIN", "SUSPENDED");
    await grantScopes(target.id, grantor.id, ALL_SCOPES);
    const application = await createApplication();

    const response = await api(
      `/api/v1/admin/driver-review/applications/${application.id}/reassign`,
      {
        method: "POST",
        token: actor.token,
        body: { targetUserId: target.id, reasonCode: "ESCALATION" }
      }
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DRIVER_REVIEW_TARGET_NOT_ELIGIBLE");
  });

  it("25. target reviewer tanpa scope CLAIM ditolak", async () => {
    const actor = await createReviewer();
    const target = await createReviewer("ADMIN", ["DRIVER_APPLICATION_QUEUE_READ"]);
    const application = await createApplication();

    const response = await api(
      `/api/v1/admin/driver-review/applications/${application.id}/reassign`,
      {
        method: "POST",
        token: actor.token,
        body: { targetUserId: target.user.id, reasonCode: "ESCALATION" }
      }
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DRIVER_REVIEW_TARGET_NOT_ELIGIBLE");
  });

  it("26. version usang ditolak", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();

    const response = await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: { expectedVersion: application.version + 5 }
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("DRIVER_REVIEW_VERSION_CONFLICT");
  });

  it("27. audit event tercipta tepat satu kali per operasi", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    await api(`/api/v1/admin/driver-review/applications/${application.id}/renew`, {
      method: "POST", token
    });
    await api(`/api/v1/admin/driver-review/applications/${application.id}/release`, {
      method: "POST", token, body: { reasonCode: "SHIFT_ENDED" }
    });

    expect(await auditCount("driver.application.claimed", application.id)).toBe(1);
    expect(await auditCount("driver.application.claim_renewed", application.id)).toBe(1);
    expect(await auditCount("driver.application.claim_released", application.id)).toBe(1);
  });

  it("28. kegagalan tidak meninggalkan mutasi parsial", async () => {
    const owner = await createReviewer();
    const other = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });
    const before = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    const auditBefore = await prisma.auditLog.count({ where: { entityId: application.id } });

    const failed = await api(`/api/v1/admin/driver-review/applications/${application.id}/renew`, {
      method: "POST", token: other.token
    });
    expect(failed.status).toBe(409);

    const after = await prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: application.id }
    });
    expect(after).toEqual(before);
    expect(await prisma.auditLog.count({ where: { entityId: application.id } })).toBe(auditBefore);
  });

  it("29. expiry bersifat lazy dan tidak membutuhkan scheduler", async () => {
    const owner = await createReviewer();
    const reader = await createReviewer();
    const application = await createApplication();
    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token: owner.token, body: {}
    });

    const active = await api("/api/v1/admin/driver-review/applications", { token: reader.token });
    const activeItem = (active.body.data as Array<{ id: string; claimActive: boolean }>).find(
      (row) => row.id === application.id
    );
    expect(activeItem?.claimActive).toBe(true);

    await prisma.$executeRaw`
      UPDATE "ride_driver_applications"
      SET "claim_expires_at" = now() - interval '1 second'
      WHERE id = ${application.id}::uuid
    `;

    // Tanpa job apa pun berjalan, pembacaan berikutnya sudah melihatnya
    // kedaluwarsa — status dinilai saat dibaca.
    const expired = await api("/api/v1/admin/driver-review/applications", { token: reader.token });
    const expiredItem = (expired.body.data as Array<{ id: string; claimActive: boolean }>).find(
      (row) => row.id === application.id
    );
    expect(expiredItem?.claimActive).toBe(false);
  });

  it("30. antrian hanya memuat status yang layak dan nol data dokumen", async () => {
    const { token } = await createReviewer();
    const submitted = await createApplication("SUBMITTED");
    const draft = await createApplication("DRAFT");

    const response = await api("/api/v1/admin/driver-review/applications", { token });
    const ids = (response.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(submitted.id);
    expect(ids).not.toContain(draft.id);

    const serialized = JSON.stringify(response.body);
    for (const forbidden of ["nik", "licenseNumber", "plateNumber", "documentUrl", "phone", "email"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  // =================================================================
  // Isolation (31-40)
  // =================================================================

  it("31-34. role, driver profile, capability, dan jalur penumpang tidak berubah", async () => {
    const { user, token } = await createReviewer();
    const application = await createApplication();
    const applicantBefore = await prisma.user.findUniqueOrThrow({
      where: { id: application.userId }
    });

    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });

    const applicantAfter = await prisma.user.findUniqueOrThrow({
      where: { id: application.userId }
    });
    expect(applicantAfter.role).toBe("USER");
    expect(applicantAfter).toEqual(applicantBefore);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("ADMIN");

    // Review TIDAK membuat profil driver maupun memberi capability.
    expect(await prisma.rideDriverProfile.count()).toBe(0);
    expect(await prisma.rideVehicle.count()).toBe(0);

    // Jalur penumpang tetap dapat dipakai.
    const quote = await prisma.rideQuote.create({
      data: {
        userId: application.userId,
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

  it("35-40. founder, membership, finansial, dan auth state identik", async () => {
    const { token } = await createReviewer();
    const application = await createApplication();

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

    const authBefore = await prisma.user.findMany({
      select: { id: true, authVersion: true, sessionsRevokedAt: true },
      orderBy: { id: "asc" }
    });
    const before = await snapshot();

    await api(`/api/v1/admin/driver-review/applications/${application.id}/claim`, {
      method: "POST", token, body: {}
    });
    await api(`/api/v1/admin/driver-review/applications/${application.id}/renew`, {
      method: "POST", token
    });
    await api(`/api/v1/admin/driver-review/applications/${application.id}/release`, {
      method: "POST", token, body: { reasonCode: "ADMIN_ERROR" }
    });

    expect(await snapshot()).toEqual(before);
    expect(
      await prisma.user.findMany({
        select: { id: true, authVersion: true, sessionsRevokedAt: true },
        orderBy: { id: "asc" }
      })
    ).toEqual(authBefore);
    expect(before.founderPlatinum).toBeLessThanOrEqual(10);
    expect(before.chairman).toBeLessThanOrEqual(1);
  });
});
