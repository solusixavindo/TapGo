import { Prisma, RideDriverStatus, UserRole } from "@prisma/client";
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
  rideLocationRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";

/**
 * Stage 5.11 — kapabilitas driver otoritatif dari database.
 *
 * Sebelumnya driverRideRouter memakai requireRoles("DRIVER","ADMIN","SUPER_ADMIN"),
 * yang hanya mencocokkan klaim role pada JWT dan tidak pernah membaca database.
 * Access token berumur 15 menit, sehingga driver yang baru di-suspend masih
 * lolos sampai tokennya kedaluwarsa, dan ADMIN/SUPER_ADMIN mendapat bypass
 * penuh ke route operasional driver.
 *
 * Sekarang kewenangan berasal dari: User.status = ACTIVE dan
 * RideDriverProfile.status = ACTIVE. Role akun tidak dipakai.
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

/** Seluruh route operasional driver yang dilindungi capability guard. */
const DRIVER_ACTION_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "POST", path: "/api/v1/driver/availability", body: { availability: "ONLINE" } },
  { method: "GET", path: "/api/v1/driver/rides/offers" },
  { method: "GET", path: "/api/v1/driver/rides/current" },
  { method: "POST", path: "/api/v1/driver/rides/RID-AB23456789/accept" },
  { method: "POST", path: "/api/v1/driver/rides/RID-AB23456789/reject" },
  { method: "POST", path: "/api/v1/driver/rides/RID-AB23456789/pickup" },
  { method: "POST", path: "/api/v1/driver/rides/RID-AB23456789/arrived" },
  { method: "POST", path: "/api/v1/driver/rides/RID-AB23456789/start" },
  { method: "POST", path: "/api/v1/driver/rides/RID-AB23456789/complete" },
  {
    method: "POST",
    path: "/api/v1/driver/rides/RID-AB23456789/cancel",
    body: { reason: "DRIVER_UNAVAILABLE" },
  },
  {
    method: "POST",
    path: "/api/v1/driver/location",
    body: { lat: -6.12, lng: 106.15, capturedAt: new Date().toISOString() },
  },
];

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
    rideLocationRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("Stage 5.11 — kapabilitas driver dari database", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "driver-capability-access-secret-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "driver-capability-refresh-secret-00000";

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
    await cleanTables();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- Penolakan berdasarkan state database --------------------------------

  it("USER tanpa driver profile ditolak pada seluruh driver action route", async () => {
    const user = await createUser("USER");
    for (const route of DRIVER_ACTION_ROUTES) {
      resetRateLimits();
      const res = await call(route, tokenFor(user));
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
      expect(res.code, `${route.method} ${route.path}`).toBe("RIDE_DRIVER_PROFILE_REQUIRED");
    }
  });

  for (const status of ["PENDING", "SUSPENDED", "REJECTED"] as const) {
    it(`driver profile ${status} ditolak pada seluruh driver action route`, async () => {
      const driver = await createDriver({ status });
      for (const route of DRIVER_ACTION_ROUTES) {
        resetRateLimits();
        const res = await call(route, tokenFor(driver.user));
        expect(res.status, `${route.method} ${route.path}`).toBe(403);
        expect(res.code, `${route.method} ${route.path}`).toBe("RIDE_DRIVER_NOT_ACTIVE");
      }
    });
  }

  it("profile ACTIVE + User ACTIVE diizinkan melewati capability guard", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await call(DRIVER_ACTION_ROUTES[0]!, tokenFor(driver.user));
    expect(res.status).toBe(200);

    // Route lain melewati guard: ditolak oleh aturan domain, BUKAN oleh
    // capability (mis. 404 karena ride tidak ada) — bukan 403 capability.
    resetRateLimits();
    const accept = await call(DRIVER_ACTION_ROUTES[2]!, tokenFor(driver.user));
    expect(accept.status).not.toBe(403);
    expect(["RIDE_DRIVER_PROFILE_REQUIRED", "RIDE_DRIVER_NOT_ACTIVE"]).not.toContain(
      accept.code,
    );
  });

  it("profile ACTIVE tetapi User non-ACTIVE ditolak dengan RIDE_DRIVER_ACCOUNT_INACTIVE", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    await prisma.user.update({
      where: { id: driver.user.id },
      data: { status: "SUSPENDED" },
    });

    for (const route of DRIVER_ACTION_ROUTES) {
      resetRateLimits();
      const res = await call(route, tokenFor(driver.user));
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
      expect(res.code, `${route.method} ${route.path}`).toBe("RIDE_DRIVER_ACCOUNT_INACTIVE");
    }
  });

  // --- Tidak ada bypass admin ----------------------------------------------

  for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
    it(`${role} tanpa active driver profile TIDAK dapat memakai driver action route`, async () => {
      const admin = await createUser(role);
      for (const route of DRIVER_ACTION_ROUTES) {
        resetRateLimits();
        const res = await call(route, tokenFor(admin));
        expect(res.status, `${route.method} ${route.path}`).toBe(403);
        expect(res.code, `${route.method} ${route.path}`).toBe("RIDE_DRIVER_PROFILE_REQUIRED");
      }
    });
  }

  it("ADMIN dengan driver profile SUSPENDED tetap ditolak (tidak ada bypass role)", async () => {
    const admin = await createDriver({ status: "SUSPENDED", role: "ADMIN" });
    const res = await call(DRIVER_ACTION_ROUTES[0]!, tokenFor(admin.user));
    expect(res.status).toBe(403);
    expect(res.code).toBe("RIDE_DRIVER_NOT_ACTIVE");
  });

  // --- Pencabutan seketika dengan token lama -------------------------------

  it("suspension berlaku SEGERA memakai access token yang diterbitkan sebelum suspend", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    // Token diterbitkan SEKALI, saat driver masih ACTIVE, lalu dipakai ulang.
    const staleToken = tokenFor(driver.user);

    const before = await call(DRIVER_ACTION_ROUTES[0]!, staleToken);
    expect(before.status).toBe(200);

    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { status: "SUSPENDED" },
    });

    // Token yang SAMA, belum kedaluwarsa, tidak dicabut — tetap ditolak.
    for (const route of DRIVER_ACTION_ROUTES) {
      resetRateLimits();
      const res = await call(route, staleToken);
      expect(res.status, `${route.method} ${route.path}`).toBe(403);
      expect(res.code, `${route.method} ${route.path}`).toBe("RIDE_DRIVER_NOT_ACTIVE");
    }
  });

  it("reject berlaku SEGERA memakai access token lama", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const staleToken = tokenFor(driver.user);
    expect((await call(DRIVER_ACTION_ROUTES[0]!, staleToken)).status).toBe(200);

    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { status: "REJECTED" },
    });

    resetRateLimits();
    const res = await call(DRIVER_ACTION_ROUTES[0]!, staleToken);
    expect(res.status).toBe(403);
    expect(res.code).toBe("RIDE_DRIVER_NOT_ACTIVE");
  });

  // --- Fungsi penumpang pada akun yang sama tetap jalan ---------------------

  it("fungsi penumpang tetap berjalan setelah driver capability disuspend", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const token = tokenFor(driver.user);

    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { status: "SUSPENDED" },
    });

    // Driver route ditolak...
    resetRateLimits();
    expect((await call(DRIVER_ACTION_ROUTES[0]!, token)).status).toBe(403);

    // ...tetapi akun yang sama tetap dapat memakai fungsi penumpang.
    resetRateLimits();
    const quote = await fetch(`${baseUrl}/api/v1/rides/quotes`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        serviceType: "MOTORCYCLE",
        pickup: { lat: -6.12, lng: 106.15, address: "Alun-Alun Serang (uji)" },
        dropoff: { lat: -6.131, lng: 106.141, address: "Pasar Rau (uji)" },
      }),
    });
    expect(quote.status).toBe(201);

    resetRateLimits();
    const list = await fetch(`${baseUrl}/api/v1/rides`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
  });

  // --- Isolasi finansial ----------------------------------------------------

  it("penolakan kapabilitas tidak menyentuh domain finansial/Business Engine", async () => {
    const before = await financialSnapshot();

    const noProfile = await createUser("USER");
    const pending = await createDriver({ status: "PENDING" });
    const suspended = await createDriver({ status: "SUSPENDED" });
    const rejected = await createDriver({ status: "REJECTED" });
    const admin = await createUser("ADMIN");

    for (const token of [
      tokenFor(noProfile),
      tokenFor(pending.user),
      tokenFor(suspended.user),
      tokenFor(rejected.user),
      tokenFor(admin),
    ]) {
      for (const route of DRIVER_ACTION_ROUTES) {
        resetRateLimits();
        await call(route, token);
      }
    }

    const after = await financialSnapshot();
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function cleanTables() {
  await prisma.auditLog.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.rideIdempotencyRecord.deleteMany();
  // RideDriverApplication memakai ON DELETE RESTRICT: tanpa baris ini
  // user.deleteMany() di bawah akan gagal dengan SQLSTATE 23001.
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

async function call(
  route: { method: string; path: string; body?: unknown },
  token: string,
): Promise<{ status: number; code?: string }> {
  const res = await fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(route.body ? { "content-type": "application/json" } : {}),
    },
    ...(route.body ? { body: JSON.stringify(route.body) } : {}),
  });
  const parsed = (await res.json().catch(() => ({}))) as { code?: string };
  return { status: res.status, ...(parsed.code ? { code: parsed.code } : {}) };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: "cap-session" });
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Cap User ${sequence}`,
      phone: `+6289${String(sequence).padStart(9, "0")}`,
      referralCode: `CAP${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createDriver(options: { status: RideDriverStatus; role?: UserRole }) {
  const user = await createUser(options.role ?? "USER");
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: options.status, availability: "OFFLINE" },
  });
  const plate = `CAP-${profile.id.slice(0, 8)}`;
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

async function financialSnapshot() {
  const [wallets, walletTransactions, commissions, rewards, withdrawals] = await Promise.all([
    prisma.wallet.count(),
    prisma.walletTransaction.count(),
    prisma.commission.count(),
    prisma.rewardTransaction.count(),
    prisma.withdrawal.count(),
  ]);
  const agg = await prisma.wallet.aggregate({
    _sum: { balance: true, cashBalance: true, ppobBalance: true },
  });
  const dec = (v: Prisma.Decimal | null) => new Prisma.Decimal(v ?? 0).toFixed(2);
  return {
    counts: { wallets, walletTransactions, commissions, rewards, withdrawals },
    sums: {
      balance: dec(agg._sum.balance),
      cashBalance: dec(agg._sum.cashBalance),
      ppobBalance: dec(agg._sum.ppobBalance),
    },
  };
}
