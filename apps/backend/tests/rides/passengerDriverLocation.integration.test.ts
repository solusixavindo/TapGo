import {
  Prisma,
  RideDriverAvailability,
  RideDriverStatus,
  RideOrderStatus,
  RideServiceType,
  UserRole,
} from "@prisma/client";
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
  rideTrackingRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";

/**
 * Posisi driver untuk penumpang (Tahap B1): hanya pemilik perjalanan, hanya
 * selama driver terlibat, tanpa identitas driver, dan titik lama ditandai stale.
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

const ACTIVE_STATUSES: RideOrderStatus[] = [
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP",
];

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
    rideTrackingRateLimiter.resetKey(key);
  }
}

async function driverLocation(token: string | null, reference: string) {
  const response = await fetch(`${baseUrl}/api/v1/rides/${reference}/driver-location`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, headers: response.headers, body: (await response.json()) as any };
}

let fixSequence = 0;
async function addFix(
  driver: Awaited<ReturnType<typeof createDriver>>,
  orderId: string | null,
  options: { ageSeconds?: number; lat?: number; lng?: number } = {},
) {
  fixSequence += 1;
  return prisma.rideDriverLocation.create({
    data: {
      driverProfileId: driver.profile.id,
      rideOrderId: orderId,
      lat: new Prisma.Decimal(options.lat ?? -6.1234567),
      lng: new Prisma.Decimal(options.lng ?? 106.1543210),
      accuracyMeters: 20,
      sequence: fixSequence,
      capturedAt: new Date(Date.now() - (options.ageSeconds ?? 5) * 1000),
    },
  });
}

describe.skipIf(!runIntegration)("Tahap B1 — posisi driver untuk penumpang", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "driver-location-access-secret-0000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "driver-location-refresh-secret-000";

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

  for (const status of ACTIVE_STATUSES) {
    it(`${status}: penumpang pemilik melihat titik terakhir dengan target dan ETA`, async () => {
      const driver = await createDriver({ status: "ACTIVE" });
      const order = await createRideOrder(driver, status);
      await addFix(driver, order.id, { ageSeconds: 30, lat: -6.1, lng: 106.1 });
      await addFix(driver, order.id, { ageSeconds: 3 });

      const res = await driverLocation(tokenFor(order.passenger), order.publicReference);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const data = res.body.data;
      expect(data.available).toBe(true);
      expect(data.lat).toBe(-6.123457);
      expect(data.lng).toBe(106.154321);
      expect(data.stale).toBe(false);
      expect(data.ageSeconds).toBeGreaterThanOrEqual(2);
      expect(data.target).toBe(status === "IN_TRIP" ? "DROPOFF" : "PICKUP");
      expect(data.distanceMeters).toBeGreaterThan(0);
      expect(data.etaSeconds).toBeGreaterThan(0);
    });
  }

  it("tanpa titik: available=false NO_FIX", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "DRIVER_TO_PICKUP");
    const res = await driverLocation(tokenFor(order.passenger), order.publicReference);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ available: false, reason: "NO_FIX" });
  });

  it("titik lebih tua dari batas segar ditandai stale (bukan disembunyikan)", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "DRIVER_TO_PICKUP");
    await addFix(driver, order.id, { ageSeconds: 300 });
    const res = await driverLocation(tokenFor(order.passenger), order.publicReference);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.stale).toBe(true);
    expect(res.body.data.ageSeconds).toBeGreaterThanOrEqual(299);
  });

  for (const status of [
    "CREATED",
    "SEARCHING_DRIVER",
    "COMPLETED",
    "CANCELLED_BY_PASSENGER",
    "CANCELLED_BY_DRIVER",
    "NO_DRIVER",
    "EXPIRED",
  ] as RideOrderStatus[]) {
    it(`${status}: posisi TIDAK diungkap walau ada titik tersimpan`, async () => {
      const driver = await createDriver({ status: "ACTIVE" });
      const order = await createRideOrder(driver, status);
      await addFix(driver, order.id);
      const res = await driverLocation(tokenFor(order.passenger), order.publicReference);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ available: false, reason: "NOT_ACTIVE" });
      expect(JSON.stringify(res.body)).not.toContain("-6.12");
    });
  }

  it("titik milik perjalanan lain dari driver yang sama tidak bocor", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "DRIVER_TO_PICKUP");
    await addFix(driver, null, { lat: -7.5, lng: 110.5 });
    const res = await driverLocation(tokenFor(order.passenger), order.publicReference);
    expect(res.body.data).toEqual({ available: false, reason: "NO_FIX" });
  });

  it("bukan pemilik (penumpang lain, driver, admin) mendapat 404 yang sama", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "IN_TRIP");
    await addFix(driver, order.id);
    const stranger = await createUser("USER");
    const admin = await createUser("SUPER_ADMIN");
    for (const actor of [stranger, driver.user, admin]) {
      const res = await driverLocation(tokenFor(actor), order.publicReference);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RIDE_ORDER_NOT_FOUND");
    }
    const missing = await driverLocation(tokenFor(stranger), "RID-ZZZZZZZZZZ");
    expect(missing.status).toBe(404);
  });

  it("tanpa token 401; referensi tidak valid 400", async () => {
    expect((await driverLocation(null, "RID-AAAAAAAAAA")).status).toBe(401);
    const user = await createUser("USER");
    expect((await driverLocation(tokenFor(user), "bukan-referensi")).status).toBe(400);
  });

  it("respons tidak memuat identitas driver, kendaraan, atau ID internal", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "IN_TRIP");
    await addFix(driver, order.id);
    const res = await driverLocation(tokenFor(order.passenger), order.publicReference);
    const serialized = JSON.stringify(res.body);
    for (const forbidden of [
      driver.user.id,
      driver.profile.id,
      driver.vehicle.id,
      order.id,
      driver.user.fullName,
      driver.user.phone,
      driver.rawPlate,
      driver.plateHash,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    const allowed = [
      "accuracyMeters", "ageSeconds", "available", "capturedAt", "distanceMeters",
      "etaSeconds", "lat", "lng", "routePolyline", "stale", "target",
    ];
    for (const key of Object.keys(res.body.data)) {
      expect(allowed, `kolom tak terduga: ${key}`).toContain(key);
    }
  });

  it("dibatasi laju: permintaan ke-61 dalam semenit ditolak 429", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "DRIVER_TO_PICKUP");
    const token = tokenFor(order.passenger);
    let last = 0;
    let code = "";
    for (let i = 0; i < 61; i += 1) {
      const res = await driverLocation(token, order.publicReference);
      last = res.status;
      code = res.body.code ?? "";
    }
    expect(last).toBe(429);
    expect(code).toBe("RIDE_TRACKING_RATE_LIMITED");
  });
});

async function cleanTables() {
  await prisma.auditLog.deleteMany();
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
  await prisma.profitSharingDistribution.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.referralLevel.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.founderProgramGrant.deleteMany();
  await prisma.userMembership.deleteMany();
  await prisma.membershipPayment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.membershipOrder.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Driver Current User ${sequence}`,
      email: `driver-current-${sequence}@example.invalid`,
      phone: `+6288${String(sequence).padStart(9, "0")}`,
      referralCode: `DCR${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createDriver(options: {
  status: RideDriverStatus;
  availability?: RideDriverAvailability;
  role?: UserRole;
}) {
  const user = await createUser(options.role ?? "USER");
  const profile = await prisma.rideDriverProfile.create({
    data: {
      userId: user.id,
      status: options.status,
      availability: options.availability ?? "OFFLINE",
    },
  });
  const rawPlate = `B ${String(sequence).padStart(4, "0")} DCR`;
  const plateHash = createHash("sha256").update(rawPlate).digest("hex");
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: plateHash,
      plateNumberMasked: "B 12•• DCR",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile, vehicle, rawPlate, plateHash };
}

async function createRideOrder(
  driver: Awaited<ReturnType<typeof createDriver>>,
  status: RideOrderStatus,
  serviceType: RideServiceType = "MOTORCYCLE",
) {
  const passenger = await createUser("USER");
  const quote = await prisma.rideQuote.create({
    data: {
      userId: passenger.id,
      serviceType,
      pickupLat: new Prisma.Decimal("-6.1200000"),
      pickupLng: new Prisma.Decimal("106.1500000"),
      pickupAddress: "LOKASI UJI A",
      dropoffLat: new Prisma.Decimal("-6.1310000"),
      dropoffLng: new Prisma.Decimal("106.1410000"),
      dropoffAddress: "LOKASI UJI B",
      distanceMeters: 2500,
      durationSeconds: 600,
      etaSeconds: 300,
      baseFare: 5000,
      distanceFare: 3000,
      serviceFee: 1000,
      subtotalFare: 9000,
      totalFare: 9000,
      fareRuleVersion: "RIDE_FARE_RULE_V1",
      roundingRule: "ROUND_TO_NEAREST_100_HALF_UP",
      distanceSource: "HAVERSINE_LOCAL_V1",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const assigned = ACTIVE_STATUSES.includes(status) || status === "COMPLETED";
  const cancelled = [
    "CANCELLED_BY_PASSENGER",
    "CANCELLED_BY_DRIVER",
    "CANCELLED_BY_SYSTEM",
  ].includes(status);
  const rawPlate = driver.rawPlate;
  const plateHash = driver.plateHash;
  const order = await prisma.rideOrder.create({
    data: {
      publicReference: `RID-${String(sequence).replace(/\d/g, (d) => "ABCDEFGHJK".charAt(Number(d))).padStart(10, "M").slice(-10)}`,
      passengerId: passenger.id,
      ...(assigned || cancelled
        ? {
            driverProfileId: driver.profile.id,
            vehicleId: driver.vehicle.id,
            assignedAt: new Date(Date.now() - 120_000),
          }
        : {}),
      quoteId: quote.id,
      serviceType,
      status,
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      pickupAddress: quote.pickupAddress,
      dropoffLat: quote.dropoffLat,
      dropoffLng: quote.dropoffLng,
      dropoffAddress: quote.dropoffAddress,
      distanceMeters: quote.distanceMeters,
      durationSeconds: quote.durationSeconds,
      baseFare: quote.baseFare,
      distanceFare: quote.distanceFare,
      serviceFee: quote.serviceFee,
      subtotalFare: quote.subtotalFare,
      totalFare: quote.totalFare,
      fareRuleVersion: quote.fareRuleVersion,
      ...(status === "DRIVER_ARRIVED" || status === "IN_TRIP" || status === "COMPLETED"
        ? { arrivedAt: new Date(Date.now() - 90_000) }
        : {}),
      ...(status === "IN_TRIP" || status === "COMPLETED"
        ? { startedAt: new Date(Date.now() - 60_000) }
        : {}),
      ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
      ...(cancelled
        ? {
            cancelledAt: new Date(),
            cancellationReason: "OTHER",
            cancelledByRole: "DRIVER",
            cancelledByUserId: driver.user.id,
            cancellationFee: 0,
            cancellationPolicy: "RIDE_CANCEL_POLICY_V1",
          }
        : {}),
    },
  });
  return { ...order, passenger, quoteId: quote.id, rawPlate, plateHash };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `current-ride-${user.id}`,
  });
}
