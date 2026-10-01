import { RideDriverStatus, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";
import {
  apiRateLimiter,
  faceCheckRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";
import { env } from "../../src/config/env.js";
import { wibCheckDate } from "../../src/modules/drivers/application/DriverFaceCheckService.js";

/**
 * Verifikasi wajah harian sebelum online.
 *
 * Dua hal yang diuji di sini BUKAN "fitur berfungsi", tapi dua sifat yang
 * mudah salah kalau diimplementasikan ulang secara ceroboh:
 *   1. Gate hanya menyala pada transisi SUNGGUHAN ke ONLINE, bukan online->
 *      online berulang, dan HANYA bila DRIVER_FACE_CHECK_ENABLED — dengan flag
 *      mati (default produksi hari ini) perilaku setAvailability harus identik
 *      dengan sebelum fitur ini ada, tanpa satu baris pengecualian pun.
 *   2. Server MENEGAKKAN ULANG ambang similarity dan batas percobaan sendiri —
 *      klien yang mengaku "passed" begitu saja tidak boleh cukup.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
    faceCheckRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("verifikasi wajah harian sebelum online", () => {
  const originalEnabled = env.DRIVER_FACE_CHECK_ENABLED;
  const originalMinSimilarity = env.DRIVER_FACE_CHECK_MIN_SIMILARITY;
  const originalMaxAttempts = env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY;
  const originalRecheckMin = env.DRIVER_FACE_CHECK_RECHECK_MIN_MINUTES;
  const originalRecheckMax = env.DRIVER_FACE_CHECK_RECHECK_MAX_MINUTES;
  const originalFatigueCar = env.DRIVER_FATIGUE_CAR_MAX_ONLINE_MINUTES;
  const originalFatigueMotorcycle = env.DRIVER_FATIGUE_MOTORCYCLE_MAX_ONLINE_MINUTES;

  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "face-check-access-secret-00000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "face-check-refresh-secret-0000000000";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;
    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    env.DRIVER_FACE_CHECK_ENABLED = false;
    env.DRIVER_FACE_CHECK_MIN_SIMILARITY = 0.75;
    env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY = 3;
    env.DRIVER_FACE_CHECK_RECHECK_MIN_MINUTES = 120;
    env.DRIVER_FACE_CHECK_RECHECK_MAX_MINUTES = 300;
    env.DRIVER_FATIGUE_CAR_MAX_ONLINE_MINUTES = 600;
    env.DRIVER_FATIGUE_MOTORCYCLE_MAX_ONLINE_MINUTES = 660;
    await cleanTables();
  });

  afterAll(async () => {
    env.DRIVER_FACE_CHECK_ENABLED = originalEnabled;
    env.DRIVER_FACE_CHECK_MIN_SIMILARITY = originalMinSimilarity;
    env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY = originalMaxAttempts;
    env.DRIVER_FACE_CHECK_RECHECK_MIN_MINUTES = originalRecheckMin;
    env.DRIVER_FACE_CHECK_RECHECK_MAX_MINUTES = originalRecheckMax;
    env.DRIVER_FATIGUE_CAR_MAX_ONLINE_MINUTES = originalFatigueCar;
    env.DRIVER_FATIGUE_MOTORCYCLE_MAX_ONLINE_MINUTES = originalFatigueMotorcycle;
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- Flag mati: nol perubahan perilaku ------------------------------------

  it("flag mati (default): online tanpa verifikasi wajah sama sekali tetap berhasil", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(res.status).toBe(200);
  });

  it("flag mati (default): GET today melaporkan DISABLED, bukan PENDING — klien tidak boleh disuruh buka kamera", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await fetch(`${baseUrl}/api/v1/driver/face-check/today`, {
      headers: { authorization: `Bearer ${tokenFor(driver.user)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("DISABLED");
  });

  it("flag hidup: GET today untuk driver yang belum pernah verifikasi hari ini melaporkan PENDING (bukan DISABLED)", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await fetch(`${baseUrl}/api/v1/driver/face-check/today`, {
      headers: { authorization: `Bearer ${tokenFor(driver.user)}` },
    });
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("PENDING");
  });

  // --- Flag hidup: gate sungguhan ---------------------------------------------

  it("flag hidup: offline->online tanpa verifikasi hari ini ditolak", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(res.status).toBe(403);
    expect(res.code).toBe("RIDE_DRIVER_FACE_CHECK_REQUIRED");
  });

  it("flag hidup: online->online berulang TIDAK digerbangi ulang (bukan transisi)", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    // Sudah ONLINE sebelum test ini menyalakan flag — memanggil ONLINE lagi
    // adalah refresh, bukan transisi offline->online, jadi tidak boleh
    // membutuhkan verifikasi wajah.
    const res = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(res.status).toBe(200);
  });

  it("flag hidup: setelah PASSED hari ini, online berhasil", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "PASSED",
        attemptCount: 1,
        passedAt: new Date(),
      },
    });
    const res = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(res.status).toBe(200);
  });

  it("flag hidup: baris BLOCKED hari ini menolak dengan kode berbeda", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "BLOCKED",
        attemptCount: 3,
        blockedAt: new Date(),
      },
    });
    const res = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(res.status).toBe(403);
    expect(res.code).toBe("RIDE_DRIVER_FACE_CHECK_BLOCKED");
  });

  // --- submitAttempt: server menegakkan ulang, tidak percaya klien ------------

  it("submitAttempt: skor di bawah ambang ditolak walau klien klaim liveness lolos", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await submitAttempt(tokenFor(driver.user), {
      similarityScore: 0.5,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(res.status).toBe(403);
    expect(res.code).toBe("RIDE_DRIVER_FACE_CHECK_MISMATCH");

    const row = await prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
    });
    expect(row?.attemptCount).toBe(1);
    expect(row?.status).toBe("PENDING");
  });

  it("submitAttempt: skor di atas ambang DAN liveness lolos -> PASSED, lalu online berhasil", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const attempt = await submitAttempt(tokenFor(driver.user), {
      similarityScore: 0.9,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(attempt.status).toBe(201);

    resetRateLimits();
    const online = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(online.status).toBe(200);
  });

  it("submitAttempt: gagal 3x berturut-turut -> BLOCKED, percobaan ke-4 langsung ditolak", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const token = tokenFor(driver.user);

    for (let i = 0; i < 3; i += 1) {
      resetRateLimits();
      const res = await submitAttempt(token, {
        similarityScore: 0.1,
        livenessPassed: true,
        modelVersion: "mobilefacenet-v1",
      });
      expect(res.status).toBe(403);
    }

    const row = await prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
    });
    expect(row?.status).toBe("BLOCKED");
    expect(row?.attemptCount).toBe(3);

    resetRateLimits();
    const fourth = await submitAttempt(token, {
      similarityScore: 0.99,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(fourth.status).toBe(403);
    expect(fourth.code).toBe("RIDE_DRIVER_FACE_CHECK_BLOCKED");
    // Tidak menambah percobaan lagi — sudah terminal untuk hari ini.
    const after = await prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
    });
    expect(after?.attemptCount).toBe(3);
  });

  it("getReference: 404 RIDE_DRIVER_FACE_REFERENCE_MISSING bila belum ada embedding", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await fetch(`${baseUrl}/api/v1/driver/face-check/reference`, {
      headers: { authorization: `Bearer ${tokenFor(driver.user)}` },
    });
    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(404);
    expect(body.code).toBe("RIDE_DRIVER_FACE_REFERENCE_MISSING");
  });

  // --- Admin override ----------------------------------------------------------

  it("admin override membuka blokir dan tercatat di AuditLog", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const admin = await createUser("SUPER_ADMIN");
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "BLOCKED",
        attemptCount: 3,
        blockedAt: new Date(),
      },
    });

    const res = await fetch(
      `${baseUrl}/api/v1/admin/driver-review/face-check/${driver.user.id}/override`,
      { method: "POST", headers: { authorization: `Bearer ${tokenFor(admin)}` } },
    );
    expect(res.status).toBe(200);

    const row = await prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
    });
    expect(row?.status).toBe("PASSED");
    expect(row?.adminOverrideById).toBe(admin.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "DRIVER_FACE_CHECK_OVERRIDE", actorId: admin.id },
    });
    expect(audit).not.toBeNull();

    resetRateLimits();
    const online = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(online.status).toBe(200);
  });

  // --- Verifikasi ulang acak (recheck) selama online --------------------------

  it("safety-status: faceRecheck.due tetap false bila flag mati, walau ada baris PASSED dengan recheckDueAt lampau", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "PASSED",
        attemptCount: 1,
        passedAt: new Date(),
        recheckDueAt: new Date(Date.now() - 60_000),
      },
    });
    const res = await safetyStatus(tokenFor(driver.user));
    expect(res.data?.faceRecheck.due).toBe(false);
  });

  it("safety-status: faceRecheck.due true begitu recheckDueAt terlewati, false sebelum waktunya", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "PASSED",
        attemptCount: 1,
        passedAt: new Date(),
        recheckDueAt: new Date(Date.now() + 3_600_000),
      },
    });
    const notYet = await safetyStatus(tokenFor(driver.user));
    expect(notYet.data?.faceRecheck.due).toBe(false);

    await prisma.driverFaceCheck.update({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
      data: { recheckDueAt: new Date(Date.now() - 1000) },
    });
    const due = await safetyStatus(tokenFor(driver.user));
    expect(due.data?.faceRecheck.due).toBe(true);
  });

  it("submitRecheckAttempt: ditolak bila belum ada PASSED hari ini", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await submitRecheckAttempt(tokenFor(driver.user), {
      similarityScore: 0.9,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(res.status).toBe(409);
    expect(res.code).toBe("RIDE_DRIVER_FACE_RECHECK_NOT_APPLICABLE");
  });

  it("submitRecheckAttempt: ditolak bila belum waktunya (recheckDueAt di masa depan)", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "PASSED",
        attemptCount: 1,
        passedAt: new Date(),
        recheckDueAt: new Date(Date.now() + 3_600_000),
      },
    });
    const res = await submitRecheckAttempt(tokenFor(driver.user), {
      similarityScore: 0.9,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(res.status).toBe(409);
    expect(res.code).toBe("RIDE_DRIVER_FACE_RECHECK_NOT_DUE");
  });

  it("submitRecheckAttempt: lolos -> tetap PASSED, recheckDueAt dijadwalkan ulang ke masa depan, TIDAK dipaksa offline", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "PASSED",
        attemptCount: 1,
        passedAt: new Date(),
        recheckDueAt: new Date(Date.now() - 1000),
      },
    });
    const res = await submitRecheckAttempt(tokenFor(driver.user), {
      similarityScore: 0.95,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(res.status).toBe(201);

    const row = await prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
    });
    expect(row?.status).toBe("PASSED");
    expect(row?.recheckDueAt?.getTime()).toBeGreaterThan(Date.now());

    const profile = await prisma.rideDriverProfile.findUnique({ where: { userId: driver.user.id } });
    expect(profile?.availability).toBe("ONLINE");
  });

  it("submitRecheckAttempt: gagal -> driver dipaksa OFFLINE seketika, status HARIAN tetap PASSED (bukan BLOCKED/PENDING), attemptCount harian tidak berubah", async () => {
    env.DRIVER_FACE_CHECK_ENABLED = true;
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { onlineSince: new Date(Date.now() - 3_600_000) },
    });
    await prisma.driverFaceCheck.create({
      data: {
        userId: driver.user.id,
        checkDate: wibCheckDate(new Date()),
        status: "PASSED",
        attemptCount: 1,
        passedAt: new Date(),
        recheckDueAt: new Date(Date.now() - 1000),
      },
    });
    const res = await submitRecheckAttempt(tokenFor(driver.user), {
      similarityScore: 0.1,
      livenessPassed: true,
      modelVersion: "mobilefacenet-v1",
    });
    expect(res.status).toBe(403);
    expect(res.code).toBe("RIDE_DRIVER_FACE_RECHECK_MISMATCH");

    const row = await prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId: driver.user.id, checkDate: wibCheckDate(new Date()) } },
    });
    expect(row?.status).toBe("PASSED");
    expect(row?.attemptCount).toBe(1);

    const profile = await prisma.rideDriverProfile.findUnique({ where: { userId: driver.user.id } });
    expect(profile?.availability).toBe("OFFLINE");
    expect(profile?.onlineSince).toBeNull();
  });

  // --- Pengingat kelelahan (fatigue nudge) -------------------------------------

  it("safety-status: restRequired false selagi offline (onlineSince kosong)", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await safetyStatus(tokenFor(driver.user));
    expect(res.data?.fatigue.restRequired).toBe(false);
    expect(res.data?.fatigue.continuousOnlineMinutes).toBe(0);
  });

  it("safety-status: restRequired true begitu jam online tanpa terputus melewati ambang motor (660 menit)", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { onlineSince: new Date(Date.now() - 661 * 60_000) },
    });
    const res = await safetyStatus(tokenFor(driver.user));
    expect(res.data?.fatigue.restRequired).toBe(true);
    expect(res.data?.fatigue.thresholdMinutes).toBe(660);
  });

  it("safety-status: belum melewati ambang -> restRequired tetap false", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { onlineSince: new Date(Date.now() - 30 * 60_000) },
    });
    const res = await safetyStatus(tokenFor(driver.user));
    expect(res.data?.fatigue.restRequired).toBe(false);
  });

  it("safety-status: driver kendaraan CAR memakai ambang 600 menit, bukan 660 milik motor", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE", vehicleType: "CAR" });
    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { onlineSince: new Date(Date.now() - 601 * 60_000) },
    });
    const res = await safetyStatus(tokenFor(driver.user));
    expect(res.data?.fatigue.thresholdMinutes).toBe(600);
    expect(res.data?.fatigue.restRequired).toBe(true);
  });

  it("driver dengan kendaraan CAR dan MOTORCYCLE aktif memakai ambang PALING KETAT (600, bukan 660)", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE", vehicleType: "MOTORCYCLE" });
    await prisma.rideVehicle.create({
      data: {
        driverProfileId: driver.profile.id,
        type: "CAR",
        plateNumberHash: createHash("sha256").update(`extra-${driver.profile.id}`).digest("hex"),
        plateNumberMasked: "B 5678 ***",
        verificationStatus: "VERIFIED",
        isActive: true,
      },
    });
    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { onlineSince: new Date(Date.now() - 605 * 60_000) },
    });
    const res = await safetyStatus(tokenFor(driver.user));
    expect(res.data?.fatigue.thresholdMinutes).toBe(600);
    expect(res.data?.fatigue.restRequired).toBe(true);
  });

  it("onlineSince TIDAK direset oleh transisi BUSY->ONLINE (jam kerja tidak terputus oleh perjalanan)", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "BUSY" });
    const eightHoursAgo = new Date(Date.now() - 8 * 3_600_000);
    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { onlineSince: eightHoursAgo },
    });
    resetRateLimits();
    const res = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(res.status).toBe(200);

    const profile = await prisma.rideDriverProfile.findUnique({ where: { userId: driver.user.id } });
    expect(profile?.onlineSince?.getTime()).toBe(eightHoursAgo.getTime());
  });

  it("onlineSince diisi saat OFFLINE->ONLINE dan dikosongkan saat ->OFFLINE", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const online = await setAvailability(tokenFor(driver.user), "ONLINE");
    expect(online.status).toBe(200);
    const afterOnline = await prisma.rideDriverProfile.findUnique({ where: { userId: driver.user.id } });
    expect(afterOnline?.onlineSince).not.toBeNull();

    resetRateLimits();
    const offline = await setAvailability(tokenFor(driver.user), "OFFLINE");
    expect(offline.status).toBe(200);
    const afterOffline = await prisma.rideDriverProfile.findUnique({ where: { userId: driver.user.id } });
    expect(afterOffline?.onlineSince).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function cleanTables() {
  await prisma.auditLog.deleteMany();
  await prisma.driverFaceCheck.deleteMany();
  await prisma.driverFaceReference.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.rideIdempotencyRecord.deleteMany();
  await prisma.rideDriverApplication.deleteMany();
  await prisma.commission.deleteMany();
  await prisma.rewardTransaction.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.referralLevel.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

async function setAvailability(token: string, availability: "ONLINE" | "OFFLINE") {
  const res = await fetch(`${baseUrl}/api/v1/driver/availability`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ availability }),
  });
  const parsed = (await res.json().catch(() => ({}))) as { code?: string };
  return { status: res.status, ...(parsed.code ? { code: parsed.code } : {}) };
}

async function submitAttempt(
  token: string,
  input: { similarityScore: number; livenessPassed: boolean; modelVersion: string },
) {
  const res = await fetch(`${baseUrl}/api/v1/driver/face-check/attempt`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = (await res.json().catch(() => ({}))) as { code?: string };
  return { status: res.status, ...(parsed.code ? { code: parsed.code } : {}) };
}

async function submitRecheckAttempt(
  token: string,
  input: { similarityScore: number; livenessPassed: boolean; modelVersion: string },
) {
  const res = await fetch(`${baseUrl}/api/v1/driver/face-check/recheck-attempt`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = (await res.json().catch(() => ({}))) as { code?: string };
  return { status: res.status, ...(parsed.code ? { code: parsed.code } : {}) };
}

async function safetyStatus(token: string) {
  const res = await fetch(`${baseUrl}/api/v1/driver/safety-status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const parsed = (await res.json().catch(() => ({}))) as {
    data?: {
      fatigue: { continuousOnlineMinutes: number; thresholdMinutes: number | null; restRequired: boolean };
      faceRecheck: { due: boolean };
    };
  };
  return { status: res.status, data: parsed.data };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: "face-check-session" });
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Face User ${sequence}`,
      phone: `+6288${String(sequence).padStart(9, "0")}`,
      referralCode: `FACE${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createDriver(options: {
  status: RideDriverStatus;
  role?: UserRole;
  availability?: "OFFLINE" | "ONLINE" | "BUSY";
  vehicleType?: "MOTORCYCLE" | "CAR";
}) {
  const user = await createUser(options.role ?? "USER");
  const profile = await prisma.rideDriverProfile.create({
    data: {
      userId: user.id,
      status: options.status,
      availability: options.availability ?? "OFFLINE",
    },
  });
  const plate = `FACE-${profile.id.slice(0, 8)}`;
  await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: options.vehicleType ?? "MOTORCYCLE",
      plateNumberHash: createHash("sha256").update(plate).digest("hex"),
      plateNumberMasked: "A 1234 ***",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile };
}
