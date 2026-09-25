import {
  Prisma,
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

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
    rideLocationRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("GET /driver/rides/history", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "driver-history-access-secret-0000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "driver-history-refresh-secret-000000";

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

  it("tanpa token ditolak 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/driver/rides/history`);
    expect(res.status).toBe(401);
  });

  it("driver tanpa riwayat mendapat daftar kosong", async () => {
    const driver = await createDriver();
    const res = await rideHistory(tokenFor(driver.user));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("mengembalikan riwayat milik driver, terbaru dulu, termasuk yang selesai/dibatalkan", async () => {
    const driver = await createDriver();
    const completed = await createRideOrder(driver, "COMPLETED", { pickupNote: "Pagar hijau" });
    const cancelled = await createRideOrder(driver, "CANCELLED_BY_PASSENGER");

    const res = await rideHistory(tokenFor(driver.user));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    // Terbaru dulu: cancelled dibuat setelah completed.
    expect(res.body.data[0].reference).toBe(cancelled.publicReference);
    expect(res.body.data[1].reference).toBe(completed.publicReference);
    expect(res.body.data[1].pickupNote).toBe("Pagar hijau");
  });

  it("order tanpa catatan mengembalikan pickupNote null, bukan hilang diam-diam", async () => {
    const driver = await createDriver();
    const order = await createRideOrder(driver, "COMPLETED");

    const res = await rideHistory(tokenFor(driver.user));
    expect(res.status).toBe(200);
    expect(res.body.data[0].reference).toBe(order.publicReference);
    expect(res.body.data[0].pickupNote).toBeNull();
  });

  it("ride milik driver lain tidak pernah ikut tampil", async () => {
    const owner = await createDriver();
    const other = await createDriver();
    await createRideOrder(owner, "COMPLETED");

    const res = await rideHistory(tokenFor(other.user));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("ride yang masih aktif (belum terminal) tetap ikut dalam riwayat", async () => {
    const driver = await createDriver();
    const active = await createRideOrder(driver, "IN_TRIP");

    const res = await rideHistory(tokenFor(driver.user));
    expect(res.status).toBe(200);
    expect(res.body.data[0].reference).toBe(active.publicReference);
  });

  it("limit membatasi jumlah baris, tetap urut terbaru dulu", async () => {
    const driver = await createDriver();
    const orders = [] as Array<{ publicReference: string }>;
    for (let i = 0; i < 5; i += 1) {
      orders.push(await createRideOrder(driver, "COMPLETED"));
    }

    const res = await rideHistory(tokenFor(driver.user), 2);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].reference).toBe(orders[4]!.publicReference);
    expect(res.body.data[1].reference).toBe(orders[3]!.publicReference);
  });

  it("USER tanpa active driver profile ditolak", async () => {
    const user = await createUser("USER");
    const res = await rideHistory(tokenFor(user));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RIDE_DRIVER_PROFILE_REQUIRED");
  });

  it("response tidak memuat PII, internal IDs, raw plate, atau blind index", async () => {
    const driver = await createDriver();
    const order = await createRideOrder(driver, "COMPLETED");

    const res = await rideHistory(tokenFor(driver.user));
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
      // Nama lengkap tidak boleh bocor — hanya nama depan (lihat
      // driverPassengerDisclosure.ts) yang boleh tampil.
      order.passenger.fullName,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Sejak "Menuju Jemput map parity", driver YANG SUDAH ditugaskan boleh
    // melihat nama depan penumpang (buildDriverDisclosure) — field
    // "passenger" karena itu memang diharapkan muncul, dibatasi ke bentuk
    // minimal { displayName } saja.
    const historyItem = (res.body.data as Array<Record<string, any>>).find(
      (row) => row.reference === order.publicReference,
    );
    expect(historyItem?.passenger).toEqual({
      displayName: order.passenger.fullName.split(" ")[0],
    });
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("plateNumberHash");
    expect(serialized).not.toContain("driverProfileId");
    expect(serialized).not.toContain("vehicleId");
  });
});

async function rideHistory(token: string, limit?: number) {
  const query = limit ? `?limit=${limit}` : "";
  const res = await fetch(`${baseUrl}/api/v1/driver/rides/history${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Driver History User ${sequence}`,
      email: `driver-history-${sequence}@example.invalid`,
      phone: `+6289${String(sequence).padStart(9, "0")}`,
      referralCode: `DHR${String(sequence).padStart(6, "0")}`,
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
  const rawPlate = `B ${String(sequence).padStart(4, "0")} DHR`;
  const plateHash = createHash("sha256").update(rawPlate).digest("hex");
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: plateHash,
      plateNumberMasked: "B 12•• DHR",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile, vehicle, rawPlate, plateHash };
}

async function createRideOrder(
  driver: Awaited<ReturnType<typeof createDriver>>,
  status: RideOrderStatus,
  options: { pickupNote?: string; serviceType?: RideServiceType } = {},
) {
  const serviceType = options.serviceType ?? "MOTORCYCLE";
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

  sequence += 1;
  const cancelled = [
    "CANCELLED_BY_PASSENGER",
    "CANCELLED_BY_DRIVER",
    "CANCELLED_BY_SYSTEM",
  ].includes(status);
  const order = await prisma.rideOrder.create({
    data: {
      publicReference: `RID-${String(sequence).padStart(10, "B").slice(-10)}`,
      passengerId: passenger.id,
      driverProfileId: driver.profile.id,
      vehicleId: driver.vehicle.id,
      assignedAt: new Date(Date.now() - 120_000),
      quoteId: quote.id,
      serviceType,
      status,
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      pickupAddress: quote.pickupAddress,
      ...(options.pickupNote ? { pickupNote: options.pickupNote } : {}),
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
  return { ...order, passenger, quoteId: quote.id, rawPlate: driver.rawPlate, plateHash: driver.plateHash };
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
    sessionId: `history-${user.id}`,
  });
}
