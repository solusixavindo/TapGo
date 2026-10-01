import { Prisma, RideOrderStatus, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, seedMemberships, testDatabaseUrl, cleanDatabase } from "../helpers/referralWalletHarness.js";
import type { PushNotifier } from "../../src/modules/notifications/application/rideNotifications.js";
import type { PushMessage } from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Tombol SOS driver (fitur keselamatan, Owner 30 Sep 2026).
 *
 * Titik uji utama: alert TERCATAT walau profil driver sedang tidak ACTIVE
 * (mis. baru disuspend) — beda dari seluruh operasi driver lain yang menuntut
 * `requireDriverProfile()` penuh — dan admin melihat + bisa menutup alert
 * lewat `listSosAlerts`/`resolveSosAlert`.
 */

class RecordingPush implements PushNotifier {
  enabled = true;
  sent: Array<{ userId: string; message: PushMessage }> = [];
  async notifyUser(userId: string, message: PushMessage) {
    this.sent.push({ userId, message });
  }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

let RideServiceClass: typeof import("../../src/modules/rides/application/RideService.js").RideService;
let sequence = 0;

function service(push?: PushNotifier) {
  return new RideServiceClass(prisma as never, {} as never, {} as never, undefined, push);
}

describe.skipIf(!runIntegration)("Tombol SOS driver", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "driver-sos-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "driver-sos-refresh-secret-00000000";
    ({ RideService: RideServiceClass } = await import("../../src/modules/rides/application/RideService.js"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    await prisma.rideSosAlert.deleteMany();
    await prisma.rideEvent.deleteMany();
    await prisma.rideDriverLocation.deleteMany();
    await prisma.rideOrder.deleteMany();
    await prisma.rideQuote.deleteMany();
    await prisma.rideVehicle.deleteMany();
    await prisma.rideDriverProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createUser(role: UserRole = "USER") {
    sequence += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        role,
        fullName: `User ${sequence}`,
        phone: `+6286${String(sequence).padStart(9, "0")}`,
        referralCode: `SOS${String(sequence).padStart(6, "0")}`,
        membershipId: basic.id
      }
    });
  }

  async function createDriver(status: "ACTIVE" | "SUSPENDED" | "PENDING" = "ACTIVE") {
    const user = await createUser("DRIVER");
    const profile = await prisma.rideDriverProfile.create({
      data: { userId: user.id, status, availability: "ONLINE" }
    });
    return { user, profile };
  }

  async function createOrderForDriver(driverProfileId: string, passengerId: string, status: RideOrderStatus = "IN_TRIP") {
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passengerId,
        serviceType: "MOTORCYCLE",
        pickupLat: new Prisma.Decimal("-6.2000000"),
        pickupLng: new Prisma.Decimal("106.8166000"),
        pickupAddress: "Titik jemput uji",
        dropoffLat: new Prisma.Decimal("-6.1000000"),
        dropoffLng: new Prisma.Decimal("106.9000000"),
        dropoffAddress: "Tujuan uji",
        distanceMeters: 3000,
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
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });
    sequence += 1;
    return prisma.rideOrder.create({
      data: {
        publicReference: `RID-${String(sequence).replace(/\d/g, (d) => "ABCDEFGHJK".charAt(Number(d))).padStart(10, "M").slice(-10)}`,
        passengerId,
        driverProfileId,
        quoteId: quote.id,
        serviceType: "MOTORCYCLE",
        status,
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        pickupAddress: quote.pickupAddress,
        dropoffLat: quote.dropoffLat,
        dropoffLng: quote.dropoffLng,
        dropoffAddress: quote.dropoffAddress,
        distanceMeters: 3000,
        durationSeconds: 600,
        baseFare: 5000,
        distanceFare: 3000,
        serviceFee: 1000,
        subtotalFare: 9000,
        totalFare: 9000,
        fareRuleVersion: "RIDE_FARE_RULE_V1",
        paymentMethod: "CASH",
        paymentState: "CASH_EXPECTED"
      }
    });
  }

  it("driver ACTIVE memicu SOS: alert tercatat OPEN dan admin aktif diberi tahu", async () => {
    const push = new RecordingPush();
    const svc = service(push);
    const { user: driverUser, profile } = await createDriver("ACTIVE");
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    const inactiveAdmin = await createUser("ADMIN");
    await prisma.user.update({ where: { id: inactiveAdmin.id }, data: { status: "SUSPENDED" } });

    const result = await svc.triggerSos({
      userId: driverUser.id,
      lat: -6.2,
      lng: 106.8166,
      accuracyMeters: 12
    });

    expect(result.status).toBe("OPEN");
    const alert = await prisma.rideSosAlert.findUniqueOrThrow({ where: { id: result.alertId } });
    expect(alert.driverProfileId).toBe(profile.id);
    expect(alert.rideOrderId).toBeNull();
    expect(Number(alert.lat)).toBeCloseTo(-6.2, 6);
    expect(alert.accuracyMeters).toBe(12);

    await flush();
    const notifiedUserIds = push.sent.map((entry) => entry.userId).sort();
    expect(notifiedUserIds).toEqual([admin.id, superAdmin.id].sort());
    expect(push.sent.every((entry) => entry.message.data?.type === "driver_sos")).toBe(true);
  });

  it("driver yang profilnya SUSPENDED tetap bisa memicu SOS (fitur keselamatan tidak boleh terkunci)", async () => {
    const svc = service();
    const { user: driverUser } = await createDriver("SUSPENDED");

    const result = await svc.triggerSos({ userId: driverUser.id, lat: -6.2, lng: 106.8166 });

    expect(result.status).toBe("OPEN");
  });

  it("akun tanpa profil driver ditolak", async () => {
    const svc = service();
    const passenger = await createUser("USER");

    await expect(svc.triggerSos({ userId: passenger.id, lat: -6.2, lng: 106.8166 })).rejects.toMatchObject({
      code: "RIDE_DRIVER_PROFILE_REQUIRED"
    });
  });

  it("koordinat tidak valid ditolak sebelum menyentuh database", async () => {
    const svc = service();
    const { user: driverUser } = await createDriver("ACTIVE");

    await expect(svc.triggerSos({ userId: driverUser.id, lat: 999, lng: 106.8166 })).rejects.toMatchObject({
      code: "RIDE_COORDINATE_INVALID"
    });
  });

  it("rideReference milik driver sendiri terlampir; milik driver lain diam-diam diabaikan", async () => {
    const svc = service();
    const { user: driverUser, profile } = await createDriver("ACTIVE");
    const passenger = await createUser("USER");
    const order = await createOrderForDriver(profile.id, passenger.id);

    const attached = await svc.triggerSos({
      userId: driverUser.id,
      lat: -6.2,
      lng: 106.8166,
      rideReference: order.publicReference
    });
    const attachedAlert = await prisma.rideSosAlert.findUniqueOrThrow({ where: { id: attached.alertId } });
    expect(attachedAlert.rideOrderId).toBe(order.id);

    const { user: otherDriverUser } = await createDriver("ACTIVE");
    const ignored = await svc.triggerSos({
      userId: otherDriverUser.id,
      lat: -6.2,
      lng: 106.8166,
      rideReference: order.publicReference
    });
    const ignoredAlert = await prisma.rideSosAlert.findUniqueOrThrow({ where: { id: ignored.alertId } });
    expect(ignoredAlert.rideOrderId).toBeNull();
  });

  it("admin melihat alert terbuka lewat listSosAlerts, dan bisa menutupnya lewat resolveSosAlert", async () => {
    const svc = service();
    const { user: driverUser } = await createDriver("ACTIVE");
    const admin = await createUser("SUPER_ADMIN");

    const triggered = await svc.triggerSos({ userId: driverUser.id, lat: -6.2, lng: 106.8166 });

    const openList = await svc.listSosAlerts({});
    expect(openList.map((a) => a.id)).toContain(triggered.alertId);
    expect(openList.find((a) => a.id === triggered.alertId)?.driver.userId).toBe(driverUser.id);

    const resolved = await svc.resolveSosAlert({
      alertId: triggered.alertId,
      resolvedById: admin.id,
      note: "Sudah dihubungi, driver aman."
    });
    expect(resolved.status).toBe("RESOLVED");

    const afterResolve = await svc.listSosAlerts({});
    expect(afterResolve.map((a) => a.id)).not.toContain(triggered.alertId);

    const resolvedOnlyList = await svc.listSosAlerts({ status: "RESOLVED" });
    expect(resolvedOnlyList.map((a) => a.id)).toContain(triggered.alertId);

    await expect(
      svc.resolveSosAlert({ alertId: triggered.alertId, resolvedById: admin.id, note: "Coba tutup lagi" })
    ).rejects.toMatchObject({ code: "RIDE_SOS_ALREADY_RESOLVED" });
  });

  it("resolveSosAlert menolak id yang tidak ada", async () => {
    const svc = service();
    const admin = await createUser("SUPER_ADMIN");
    await expect(
      svc.resolveSosAlert({ alertId: "00000000-0000-0000-0000-000000000000", resolvedById: admin.id, note: "x" })
    ).rejects.toMatchObject({ code: "RIDE_SOS_NOT_FOUND" });
  });
});
