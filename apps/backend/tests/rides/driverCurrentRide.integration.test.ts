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

const ACTIVE_STATUSES: RideOrderStatus[] = [
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP",
];

const TERMINAL_STATUSES: RideOrderStatus[] = [
  "COMPLETED",
  "CANCELLED_BY_PASSENGER",
  "CANCELLED_BY_DRIVER",
  "CANCELLED_BY_SYSTEM",
  "NO_DRIVER",
  "EXPIRED",
  "PAYMENT_FAILED",
];

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
    rideLocationRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("Stage R2.5A — current ride driver restoration", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "driver-current-access-secret-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "driver-current-refresh-secret-00000";

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

  it("active driver tanpa active ride mendapat data null", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const res = await currentRide(tokenFor(driver.user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  for (const status of ACTIVE_STATUSES) {
    it(`${status} dikembalikan sebagai current ride`, async () => {
      const driver = await createDriver({ status: "ACTIVE", availability: "OFFLINE" });
      const order = await createRideOrder(driver, status);

      const res = await currentRide(tokenFor(driver.user));
      expect(res.status).toBe(200);
      expect(res.body.data.reference).toBe(order.publicReference);
      expect(res.body.data.status).toBe(status);
      expect(res.body.data.isFinal).toBe(false);
    });
  }

  for (const status of TERMINAL_STATUSES) {
    it(`${status} tidak dikembalikan`, async () => {
      const driver = await createDriver({ status: "ACTIVE" });
      await createRideOrder(driver, status);

      const res = await currentRide(tokenFor(driver.user));
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  }

  it("ride milik driver lain tidak pernah dikembalikan", async () => {
    const owner = await createDriver({ status: "ACTIVE" });
    const other = await createDriver({ status: "ACTIVE" });
    await createRideOrder(owner, "IN_TRIP");

    const res = await currentRide(tokenFor(other.user));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("tanpa token ditolak 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/driver/rides/current`);
    expect(res.status).toBe(401);
  });

  it("USER/ADMIN/SUPER_ADMIN tanpa active driver profile ditolak", async () => {
    for (const role of ["USER", "ADMIN", "SUPER_ADMIN"] as const) {
      const user = await createUser(role);
      const res = await currentRide(tokenFor(user));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("RIDE_DRIVER_PROFILE_REQUIRED");
    }
  });

  for (const status of ["PENDING", "SUSPENDED", "REJECTED"] as const) {
    it(`driver profile ${status} ditolak`, async () => {
      const driver = await createDriver({ status });
      const res = await currentRide(tokenFor(driver.user));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("RIDE_DRIVER_NOT_ACTIVE");
    });
  }

  it("profile ACTIVE + User inactive ditolak", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    await prisma.user.update({ where: { id: driver.user.id }, data: { status: "SUSPENDED" } });

    const res = await currentRide(tokenFor(driver.user));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RIDE_DRIVER_ACCOUNT_INACTIVE");
  });

  it("suspension berlaku segera memakai token lama yang sama", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    await createRideOrder(driver, "DRIVER_ASSIGNED");
    const staleToken = tokenFor(driver.user);
    expect((await currentRide(staleToken)).status).toBe(200);

    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { status: "SUSPENDED" },
    });

    const res = await currentRide(staleToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RIDE_DRIVER_NOT_ACTIVE");
  });

  it("OFFLINE driver dengan active ride tetap memperoleh current ride", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "OFFLINE" });
    const order = await createRideOrder(driver, "DRIVER_TO_PICKUP");

    const res = await currentRide(tokenFor(driver.user));
    expect(res.status).toBe(200);
    expect(res.body.data.reference).toBe(order.publicReference);
  });

  it("multiple active rides fail closed dengan RIDE_DRIVER_ACTIVE_RIDE_CONFLICT", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    await createRideOrder(driver, "DRIVER_ASSIGNED");
    await createRideOrder(driver, "IN_TRIP");

    const res = await currentRide(tokenFor(driver.user));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RIDE_DRIVER_ACTIVE_RIDE_CONFLICT");
    expect(JSON.stringify(res.body)).not.toContain("RID-");
  });

  it("response tidak memuat PII, internal IDs, raw plate, atau blind index", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "IN_TRIP");

    const res = await currentRide(tokenFor(driver.user));
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).toContain(order.publicReference);
    for (const forbidden of [
      driver.user.id,
      driver.profile.id,
      driver.vehicle.id,
      order.id,
      order.passenger.id,
      order.quoteId,
      order.vehicleId,
      order.driverProfileId,
      order.rawPlate,
      order.plateHash,
      order.passenger.phone,
      order.passenger.email,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("passenger");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("plateNumberHash");
    expect(serialized).not.toContain("driverProfileId");
    expect(serialized).not.toContain("vehicleId");
  });

  it("current ride GET tidak melakukan mutation terhadap order, lokasi, atau availability", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "OFFLINE" });
    const order = await createRideOrder(driver, "DRIVER_ARRIVED");
    const before = await mutationSnapshot(driver.profile.id, order.id);

    expect((await currentRide(tokenFor(driver.user))).status).toBe(200);
    expect((await currentRide(tokenFor(driver.user))).status).toBe(200);

    const after = await mutationSnapshot(driver.profile.id, order.id);
    expect(after).toEqual(before);
  });

  it("concurrent GET konsisten dan mengikuti database terbaru setelah terminal", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "IN_TRIP");
    const token = tokenFor(driver.user);

    const [a, b] = await Promise.all([currentRide(token), currentRide(token)]);
    expect(a.body.data.reference).toBe(order.publicReference);
    expect(b.body.data.reference).toBe(order.publicReference);

    await prisma.rideOrder.update({
      where: { id: order.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    const after = await currentRide(token);
    expect(after.status).toBe(200);
    expect(after.body.data).toBeNull();
  });

  it("offers dan fungsi penumpang akun yang sama tetap berjalan setelah driver suspension", async () => {
    const driver = await createDriver({ status: "ACTIVE", availability: "ONLINE" });
    const token = tokenFor(driver.user);
    const offers = await fetch(`${baseUrl}/api/v1/driver/rides/offers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(offers.status).toBe(200);

    await prisma.rideDriverProfile.update({
      where: { id: driver.profile.id },
      data: { status: "SUSPENDED" },
    });
    expect((await currentRide(token)).status).toBe(403);

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
  });

  it("Membership/Founder/Chairman dan financial Business Engine tidak berubah", async () => {
    const before = await businessSnapshot();
    const driver = await createDriver({ status: "ACTIVE" });
    await createRideOrder(driver, "IN_TRIP");
    expect((await currentRide(tokenFor(driver.user))).status).toBe(200);
    expect(await businessSnapshot()).toEqual(before);
  });
});

async function currentRide(token: string) {
  const res = await fetch(`${baseUrl}/api/v1/driver/rides/current`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
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
      publicReference: `RID-${String(sequence).padStart(10, "A").slice(-10)}`,
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

async function mutationSnapshot(driverProfileId: string, orderId: string) {
  const [order, locationCount, driver] = await Promise.all([
    prisma.rideOrder.findUniqueOrThrow({ where: { id: orderId } }),
    prisma.rideDriverLocation.count(),
    prisma.rideDriverProfile.findUniqueOrThrow({ where: { id: driverProfileId } }),
  ]);
  return {
    order: {
      status: order.status,
      updatedAt: order.updatedAt.toISOString(),
      driverProfileId: order.driverProfileId,
      vehicleId: order.vehicleId,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      completedAt: order.completedAt?.toISOString() ?? null,
    },
    locationCount,
    availability: driver.availability,
  };
}

async function businessSnapshot() {
  const [
    wallets,
    walletTransactions,
    commissions,
    rewards,
    profitSharing,
    referrals,
    founderProgramGrants,
    userMemberships,
    membershipOrders,
    invoices,
    membershipPayments,
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.walletTransaction.count(),
    prisma.commission.count(),
    prisma.rewardTransaction.count(),
    prisma.profitSharingDistribution.count(),
    prisma.referral.count(),
    prisma.founderProgramGrant.count(),
    prisma.userMembership.count(),
    prisma.membershipOrder.count(),
    prisma.invoice.count(),
    prisma.membershipPayment.count(),
  ]);
  return {
    wallets,
    walletTransactions,
    commissions,
    rewards,
    profitSharing,
    referrals,
    founderProgramGrants,
    userMemberships,
    membershipOrders,
    invoices,
    membershipPayments,
  };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `current-ride-${user.id}`,
  });
}
