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
    await cleanTables();
  });

  afterAll(async () => {
    env.DRIVER_FACE_CHECK_ENABLED = originalEnabled;
    env.DRIVER_FACE_CHECK_MIN_SIMILARITY = originalMinSimilarity;
    env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY = originalMaxAttempts;
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
      type: "MOTORCYCLE",
      plateNumberHash: createHash("sha256").update(plate).digest("hex"),
      plateNumberMasked: "A 1234 ***",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile };
}
