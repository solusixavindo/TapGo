import {
  Prisma,
  RideEventType,
  RideOrderStatus,
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
  rideLocationRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";

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
    rideLocationRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)(
  "GET /driver/earnings/summary dan GET /driver/performance",
  () => {
    beforeAll(async () => {
      if (!testDatabaseUrl?.toLowerCase().includes("test")) {
        throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
      }
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = testDatabaseUrl;
      process.env.JWT_ACCESS_SECRET =
        process.env.JWT_ACCESS_SECRET ?? "driver-earnings-access-secret-0000";
      process.env.JWT_REFRESH_SECRET =
        process.env.JWT_REFRESH_SECRET ?? "driver-earnings-refresh-secret-000";

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

    it("tanpa token ditolak 401 pada kedua endpoint", async () => {
      expect((await fetch(`${baseUrl}/api/v1/driver/earnings/summary`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/v1/driver/performance`)).status).toBe(401);
    });

    it("belum ada data sama sekali -> angka nol/null, bukan crash", async () => {
      const driver = await createDriver();

      const earnings = await earningsSummary(tokenFor(driver.user));
      expect(earnings.status).toBe(200);
      expect(earnings.body.data.tripCount).toBe(0);
      expect(earnings.body.data.grossFare).toBe(0);
      expect(earnings.body.data.byDay).toEqual([]);

      const performance = await performanceSummary(tokenFor(driver.user));
      expect(performance.status).toBe(200);
      expect(performance.body.data.totalTrips).toBe(0);
      expect(performance.body.data.acceptanceRate).toBeNull();
      expect(performance.body.data.completionRate).toBeNull();
      expect(performance.body.data.cancellationRate).toBeNull();
    });

    it("earnings menjumlahkan hanya order COMPLETED milik driver ini, di dalam rentang", async () => {
      const driver = await createDriver();
      const other = await createDriver();
      await createRideOrder(driver, "COMPLETED", { totalFare: 9000 });
      await createRideOrder(driver, "COMPLETED", { totalFare: 15000 });
      // Tidak ikut dihitung: belum selesai, dan milik driver lain.
      await createRideOrder(driver, "IN_TRIP", { totalFare: 20000 });
      await createRideOrder(other, "COMPLETED", { totalFare: 50000 });

      const res = await earningsSummary(tokenFor(driver.user));
      expect(res.status).toBe(200);
      expect(res.body.data.tripCount).toBe(2);
      expect(res.body.data.grossFare).toBe(24000);
      expect(res.body.data.currency).toBe("IDR");
      expect(res.body.data.byDay).toHaveLength(1);
      expect(res.body.data.byDay[0].tripCount).toBe(2);
      expect(res.body.data.byDay[0].grossFare).toBe(24000);
    });

    it("range di luar allowlist jatuh ke 'today', bukan error", async () => {
      const driver = await createDriver();
      const res = await earningsSummary(tokenFor(driver.user), "bogus");
      expect(res.status).toBe(200);
      expect(res.body.data.range).toBe("today");
    });

    it("acceptanceRate dari DRIVER_ASSIGNED vs DRIVER_REJECTED_OFFER milik driver ini saja", async () => {
      const driver = await createDriver();
      const other = await createDriver();
      const order = await createRideOrder(driver, "COMPLETED");

      await createRideEvent(order, "DRIVER_ASSIGNED", driver.user.id);
      await createRideEvent(order, "DRIVER_ASSIGNED", driver.user.id);
      await createRideEvent(order, "DRIVER_REJECTED_OFFER", driver.user.id);
      // Event driver lain tidak ikut memengaruhi angka driver ini.
      await createRideEvent(order, "DRIVER_REJECTED_OFFER", other.user.id);

      const res = await performanceSummary(tokenFor(driver.user));
      expect(res.status).toBe(200);
      expect(res.body.data.acceptanceRate).toBeCloseTo(2 / 3);
    });

    it("completionRate/cancellationRate mengecualikan pembatalan penumpang/sistem", async () => {
      const driver = await createDriver();
      await createRideOrder(driver, "COMPLETED");
      await createRideOrder(driver, "COMPLETED");
      await createRideOrder(driver, "CANCELLED_BY_DRIVER");
      // Dikecualikan dari penyebut: bukan keputusan driver.
      await createRideOrder(driver, "CANCELLED_BY_PASSENGER");
      await createRideOrder(driver, "CANCELLED_BY_SYSTEM");

      const res = await performanceSummary(tokenFor(driver.user));
      expect(res.status).toBe(200);
      expect(res.body.data.totalTrips).toBe(2);
      expect(res.body.data.completionRate).toBeCloseTo(2 / 3);
      expect(res.body.data.cancellationRate).toBeCloseTo(1 / 3);
    });

    it("USER tanpa active driver profile ditolak pada kedua endpoint", async () => {
      const user = await createUser("USER");
      const earnings = await earningsSummary(tokenFor(user));
      expect(earnings.status).toBe(403);
      expect(earnings.body.code).toBe("RIDE_DRIVER_PROFILE_REQUIRED");

      const performance = await performanceSummary(tokenFor(user));
      expect(performance.status).toBe(403);
      expect(performance.body.code).toBe("RIDE_DRIVER_PROFILE_REQUIRED");
    });

    it("response tidak memuat PII, internal IDs, raw plate, atau blind index", async () => {
      const driver = await createDriver();
      await createRideOrder(driver, "COMPLETED");

      const earnings = await earningsSummary(tokenFor(driver.user));
      const performance = await performanceSummary(tokenFor(driver.user));
      for (const body of [earnings.body, performance.body]) {
        const serialized = JSON.stringify(body);
        for (const forbidden of [
          driver.user.id,
          driver.profile.id,
          driver.vehicle.id,
          driver.rawPlate,
          driver.plateHash,
        ]) {
          expect(serialized).not.toContain(forbidden);
        }
        expect(serialized).not.toContain("plateNumberHash");
        expect(serialized).not.toContain("driverProfileId");
      }
    });
  },
);

async function earningsSummary(token: string, range?: string) {
  const query = range ? `?range=${range}` : "";
  const res = await fetch(`${baseUrl}/api/v1/driver/earnings/summary${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

async function performanceSummary(token: string) {
  const res = await fetch(`${baseUrl}/api/v1/driver/performance`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Driver Earnings User ${sequence}`,
      email: `driver-earnings-${sequence}@example.invalid`,
      phone: `+6287${String(sequence).padStart(9, "0")}`,
      referralCode: `DEP${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createDriver(options: { role?: UserRole } = {}) {
  const user = await createUser(options.role ?? "USER");
  const profile = await prisma.rideDriverProfile.create({
    data: {
      userId: user.id,
      status: "ACTIVE",
      availability: "OFFLINE",
    },
  });
  const rawPlate = `B ${String(sequence).padStart(4, "0")} DEP`;
  const plateHash = createHash("sha256").update(rawPlate).digest("hex");
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: plateHash,
      plateNumberMasked: "B 12•• DEP",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile, vehicle, rawPlate, plateHash };
}

async function createRideOrder(
  driver: Awaited<ReturnType<typeof createDriver>>,
  status: RideOrderStatus,
  options: { totalFare?: number } = {},
) {
  const totalFare = options.totalFare ?? 9000;
  const passenger = await createUser("USER");
  const quote = await prisma.rideQuote.create({
    data: {
      userId: passenger.id,
      serviceType: "MOTORCYCLE",
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
      subtotalFare: totalFare,
      totalFare,
      fareRuleVersion: "RIDE_FARE_RULE_V1",
      roundingRule: "ROUND_TO_NEAREST_100_HALF_UP",
      distanceSource: "HAVERSINE_LOCAL_V1",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  sequence += 1;
  const cancelled = [
    "CANCELLED_BY_PASSENGER",
    "CANCELLED_BY_DRIVER",
    "CANCELLED_BY_SYSTEM",
  ].includes(status);
  const order = await prisma.rideOrder.create({
    data: {
      publicReference: `RID-${String(sequence).padStart(10, "C").slice(-10)}`,
      passengerId: passenger.id,
      driverProfileId: driver.profile.id,
      vehicleId: driver.vehicle.id,
      assignedAt: new Date(Date.now() - 120_000),
      quoteId: quote.id,
      serviceType: "MOTORCYCLE",
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
      ...(status === "COMPLETED" ? { arrivedAt: new Date(Date.now() - 90_000) } : {}),
      ...(status === "COMPLETED" || status === "IN_TRIP"
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
  return order;
}

async function createRideEvent(
  order: { id: string },
  type: RideEventType,
  actorUserId: string,
) {
  sequence += 1;
  return prisma.rideEvent.create({
    data: {
      rideOrderId: order.id,
      type,
      actorUserId,
      actorRole: "DRIVER",
      eventKey: `${order.id}:${type}:${sequence}`,
    },
  });
}

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
  await prisma.userMembership.deleteMany();
  await prisma.membershipPayment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.membershipOrder.deleteMany();
  await prisma.user.deleteMany();
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `earnings-${user.id}`,
  });
}
