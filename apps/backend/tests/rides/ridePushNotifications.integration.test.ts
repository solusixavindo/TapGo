import {
  Prisma,
  RideDriverAvailability,
  RideDriverStatus,
  RideOrderStatus,
  RideServiceType,
  UserRole,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import type { PushNotifier } from "../../src/modules/notifications/application/rideNotifications.js";
import type { PushMessage } from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Notifikasi push untuk penumpang pada perubahan status perjalanan: terkirim
 * sekali per perubahan nyata, hanya setelah commit, tanpa data sensitif, dan
 * kegagalan push tidak mengubah hasil perubahan status.
 */
let sequence = 0;
const ACTIVE_STATUSES: RideOrderStatus[] = ["DRIVER_ASSIGNED", "DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_TRIP"];

class RecordingPush implements PushNotifier {
  enabled = true;
  sent: Array<{ userId: string; message: PushMessage }> = [];
  failWith: Error | null = null;
  async notifyUser(userId: string, message: PushMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ userId, message });
  }
}

let RideServiceClass: typeof import("../../src/modules/rides/application/RideService.js").RideService;

function makeService(push: PushNotifier) {
  return new RideServiceClass(prisma as never, {} as never, {} as never, undefined, push);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

describe.skipIf(!runIntegration)("Push notifikasi status perjalanan", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "ride-push-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "ride-push-refresh-secret-00000000";
    ({ RideService: RideServiceClass } = await import("../../src/modules/rides/application/RideService.js"));
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("driver menerima order: penumpang diberi tahu sekali; menerima ulang tidak menggandakan", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "SEARCHING_DRIVER");
    const push = new RecordingPush();
    const service = makeService(push);

    await service.acceptOrder({ userId: driver.user.id, publicReference: order.publicReference });
    await service.acceptOrder({ userId: driver.user.id, publicReference: order.publicReference });
    await flush();

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.userId).toBe(order.passenger.id);
    expect(push.sent[0]!.message.title).toBe("Driver ditemukan");
    expect(push.sent[0]!.message.data).toEqual({
      type: "ride_status",
      rideReference: order.publicReference,
      status: "DRIVER_ASSIGNED",
    });
  });

  it("isi notifikasi tidak memuat alamat, nama, atau nominal", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "SEARCHING_DRIVER");
    const push = new RecordingPush();
    await makeService(push).acceptOrder({ userId: driver.user.id, publicReference: order.publicReference });
    await flush();
    const text = JSON.stringify(push.sent[0]!.message);
    expect(text).not.toContain("LOKASI UJI");
    expect(text).not.toContain(driver.user.fullName);
    expect(text).not.toMatch(/Rp|9000/);
  });

  it("driver tiba dan selesai: notifikasi masing-masing; status tanpa pesan (menuju jemput, mulai) diam; ulang tidak menggandakan", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "DRIVER_ASSIGNED");
    const push = new RecordingPush();
    const service = makeService(push);
    const ref = order.publicReference;

    await service.advanceByDriver({ userId: driver.user.id, publicReference: ref, next: "DRIVER_TO_PICKUP" });
    await service.advanceByDriver({ userId: driver.user.id, publicReference: ref, next: "DRIVER_ARRIVED" });
    await service.advanceByDriver({ userId: driver.user.id, publicReference: ref, next: "DRIVER_ARRIVED" });
    await service.advanceByDriver({ userId: driver.user.id, publicReference: ref, next: "IN_TRIP" });
    await service.advanceByDriver({ userId: driver.user.id, publicReference: ref, next: "COMPLETED" });
    await flush();

    expect(push.sent.map((entry) => entry.message.title)).toEqual(["Driver sudah tiba", "Perjalanan selesai"]);
  });

  it("driver membatalkan: penumpang diberi tahu", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "DRIVER_ASSIGNED");
    const push = new RecordingPush();
    await makeService(push).cancelByDriver({
      userId: driver.user.id,
      publicReference: order.publicReference,
      reason: "VEHICLE_PROBLEM",
    });
    await flush();
    expect(push.sent.map((entry) => entry.message.title)).toEqual(["Perjalanan dibatalkan"]);
  });

  it("push yang gagal tidak mengubah hasil: status tetap berubah dan tidak melempar", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "SEARCHING_DRIVER");
    const push = new RecordingPush();
    push.failWith = new Error("fcm down");
    const view = await makeService(push).acceptOrder({
      userId: driver.user.id,
      publicReference: order.publicReference,
    });
    await flush();
    expect(view.status).toBe("DRIVER_ASSIGNED");
    const stored = await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("DRIVER_ASSIGNED");
  });

  it("layanan push nonaktif: tidak ada pencarian tambahan dan alur tetap jalan", async () => {
    const driver = await createDriver({ status: "ACTIVE" });
    const order = await createRideOrder(driver, "SEARCHING_DRIVER");
    const push = new RecordingPush();
    push.enabled = false;
    const view = await makeService(push).acceptOrder({
      userId: driver.user.id,
      publicReference: order.publicReference,
    });
    await flush();
    expect(view.status).toBe("DRIVER_ASSIGNED");
    expect(push.sent).toHaveLength(0);
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

