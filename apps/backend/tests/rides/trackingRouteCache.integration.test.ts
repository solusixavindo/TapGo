import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Estimasi rute pelacakan penumpang dipakai ulang beberapa detik per pesanan+tujuan (OSRM ~0,5 dtk per panggilan,
 * penumpang mengambil posisi tiap 1,5 dtk). Posisi marker tetap yang terbaru; hanya rute/jarak/ETA yang boleh tertinggal.
 */
let RideServiceClass: typeof import("../../src/modules/rides/application/RideService.js").RideService;
let sequence = 0;

describe.skipIf(!runIntegration)("cache estimasi rute pelacakan penumpang", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "route-cache-access-secret-0000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "route-cache-refresh-secret-000000000";
    ({ RideService: RideServiceClass } = await import("../../src/modules/rides/application/RideService.js"));
  });

  beforeEach(async () => {
    await prisma.rideEvent.deleteMany();
    await prisma.rideDriverLocation.deleteMany();
    await prisma.rideOrder.deleteMany();
    await prisma.rideQuote.deleteMany();
    await prisma.rideVehicle.deleteMany();
    await prisma.rideDriverProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function user() {
    sequence += 1;
    return prisma.user.create({
      data: { fullName: `Cache ${sequence}`, phone: `+6283${String(sequence).padStart(9, "0")}`, referralCode: `RCH${String(sequence).padStart(6, "0")}` }
    });
  }

  async function seed(status: "DRIVER_TO_PICKUP" | "IN_TRIP" = "DRIVER_TO_PICKUP") {
    const driverUser = await user();
    const passenger = await user();
    const profile = await prisma.rideDriverProfile.create({ data: { userId: driverUser.id, status: "ACTIVE", availability: "BUSY" } });
    const vehicle = await prisma.rideVehicle.create({
      data: {
        driverProfileId: profile.id,
        type: "MOTORCYCLE",
        plateNumberHash: createHash("sha256").update(`P${sequence}`).digest("hex"),
        plateNumberMasked: "B 12•• XX",
        verificationStatus: "VERIFIED",
        isActive: true
      }
    });
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passenger.id, serviceType: "MOTORCYCLE",
        pickupLat: new Prisma.Decimal("-6.1200000"), pickupLng: new Prisma.Decimal("106.1500000"), pickupAddress: "A",
        dropoffLat: new Prisma.Decimal("-6.1310000"), dropoffLng: new Prisma.Decimal("106.1410000"), dropoffAddress: "B",
        distanceMeters: 2500, durationSeconds: 600, etaSeconds: 300, baseFare: 5000, distanceFare: 3000, serviceFee: 1000,
        subtotalFare: 9000, totalFare: 9000, fareRuleVersion: "RIDE_FARE_RULE_V1", roundingRule: "ROUND_TO_NEAREST_100_HALF_UP",
        distanceSource: "HAVERSINE_LOCAL_V1", expiresAt: new Date(Date.now() + 600_000)
      }
    });
    const order = await prisma.rideOrder.create({
      data: {
        publicReference: `RID-${String(sequence).replace(/\d/g, (d) => "ABCDEFGHJK".charAt(Number(d))).padStart(10, "M").slice(-10)}`,
        passengerId: passenger.id, driverProfileId: profile.id, vehicleId: vehicle.id, quoteId: quote.id,
        serviceType: "MOTORCYCLE", status,
        pickupLat: quote.pickupLat, pickupLng: quote.pickupLng, pickupAddress: "A",
        dropoffLat: quote.dropoffLat, dropoffLng: quote.dropoffLng, dropoffAddress: "B",
        distanceMeters: 2500, durationSeconds: 600, baseFare: 5000, distanceFare: 3000, serviceFee: 1000, subtotalFare: 9000, totalFare: 9000,
        fareRuleVersion: "RIDE_FARE_RULE_V1", assignedAt: new Date(Date.now() - 60_000)
      }
    });
    return { passenger, profile, order };
  }

  let fixSeq = 0;
  async function fix(profileId: string, orderId: string, lat: number) {
    fixSeq += 1;
    await prisma.rideDriverLocation.create({
      data: { driverProfileId: profileId, rideOrderId: orderId, lat: new Prisma.Decimal(lat), lng: new Prisma.Decimal(106.15), accuracyMeters: 8, sequence: fixSeq, capturedAt: new Date() }
    });
  }

  function service(counter: { calls: number }) {
    const distance = {
      estimate: async () => {
        counter.calls += 1;
        return { distanceMeters: 1000 + counter.calls, etaSeconds: 120, routePolyline: "abc" };
      }
    };
    return new RideServiceClass(prisma as never, distance as never, {} as never);
  }

  it("dua pengambilan beruntun hanya memanggil penyedia rute sekali, tetapi posisi tetap yang terbaru", async () => {
    const { passenger, profile, order } = await seed();
    const counter = { calls: 0 };
    const svc = service(counter);
    await fix(profile.id, order.id, -6.1400);
    const first = await svc.getDriverLocationForPassenger(passenger.id, order.publicReference);
    await fix(profile.id, order.id, -6.1350);
    const second = await svc.getDriverLocationForPassenger(passenger.id, order.publicReference);
    expect(counter.calls).toBe(1);
    expect(first.available && second.available).toBe(true);
    if (first.available && second.available) {
      expect(first.lat).toBe(-6.14);
      expect(second.lat).toBe(-6.135); // marker mengikuti titik terbaru
      expect(second.distanceMeters).toBe(first.distanceMeters); // rute/jarak dipakai ulang
      expect(second.routePolyline).toBe("abc");
    }
  });

  it("setelah masa berlaku habis rute dihitung ulang", async () => {
    const { passenger, profile, order } = await seed();
    const counter = { calls: 0 };
    const svc = service(counter);
    await fix(profile.id, order.id, -6.14);
    const t0 = new Date();
    await svc.getDriverLocationForPassenger(passenger.id, order.publicReference, t0);
    await svc.getDriverLocationForPassenger(passenger.id, order.publicReference, new Date(t0.getTime() + 4_000));
    expect(counter.calls).toBe(1);
    await svc.getDriverLocationForPassenger(passenger.id, order.publicReference, new Date(t0.getTime() + 5_500));
    expect(counter.calls).toBe(2);
  });

  it("cache terpisah per pesanan dan per tujuan (menuju jemput vs mengantar)", async () => {
    const a = await seed();
    const b = await seed();
    const counter = { calls: 0 };
    const svc = service(counter);
    await fix(a.profile.id, a.order.id, -6.14);
    await fix(b.profile.id, b.order.id, -6.14);
    await svc.getDriverLocationForPassenger(a.passenger.id, a.order.publicReference);
    await svc.getDriverLocationForPassenger(b.passenger.id, b.order.publicReference);
    expect(counter.calls).toBe(2);
    await prisma.rideOrder.update({ where: { id: a.order.id }, data: { status: "IN_TRIP" } });
    await svc.getDriverLocationForPassenger(a.passenger.id, a.order.publicReference);
    expect(counter.calls).toBe(3); // tujuan berganti (DROPOFF): rute baru
  });

  it("kegagalan penyedia rute tidak di-cache: panggilan berikutnya mencoba lagi", async () => {
    const { passenger, profile, order } = await seed();
    let calls = 0;
    const flaky = {
      estimate: async () => {
        calls += 1;
        if (calls === 1) throw new Error("OSRM down");
        return { distanceMeters: 900, etaSeconds: 100, routePolyline: "xyz" };
      }
    };
    const svc = new RideServiceClass(prisma as never, flaky as never, {} as never);
    await fix(profile.id, order.id, -6.14);
    const first = await svc.getDriverLocationForPassenger(passenger.id, order.publicReference);
    const second = await svc.getDriverLocationForPassenger(passenger.id, order.publicReference);
    expect(calls).toBe(2);
    if (first.available && second.available) {
      expect(first.routePolyline).toBeUndefined(); // garis lurus saat gagal
      expect(second.routePolyline).toBe("xyz");
    }
  });
});
