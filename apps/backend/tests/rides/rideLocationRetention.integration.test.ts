import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Penghapusan titik lokasi driver lama: jejak perjalanan disimpan RIDE_LOCATION_RETENTION_DAYS (14 hari
 * bawaan), titik tanpa perjalanan hanya 1 hari, dan titik yang masih baru tidak pernah tersentuh.
 */
const DAY = 24 * 60 * 60 * 1000;
let n = 0;

describe.skipIf(!runIntegration)("Retensi titik lokasi driver", () => {
  beforeEach(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    await prisma.rideDriverLocation.deleteMany();
    await prisma.rideOrder.deleteMany();
    await prisma.rideQuote.deleteMany();
    await prisma.rideVehicle.deleteMany();
    await prisma.rideDriverProfile.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.rideDriverLocation.deleteMany();
  });

  async function profile() {
    n += 1;
    const user = await prisma.user.create({
      data: {
        fullName: `Retensi ${n}`,
        email: `retensi-${n}@example.invalid`,
        phone: `+6287${String(n).padStart(9, "0")}`,
        referralCode: `RTN${String(n).padStart(6, "0")}`,
        role: "USER",
      },
    });
    return prisma.rideDriverProfile.create({ data: { userId: user.id, status: "ACTIVE" } });
  }

  async function point(profileId: string, ageMs: number, rideOrderId: string | null = null) {
    n += 1;
    return prisma.rideDriverLocation.create({
      data: {
        driverProfileId: profileId,
        rideOrderId,
        lat: new Prisma.Decimal(-6.1),
        lng: new Prisma.Decimal(106.1),
        accuracyMeters: 10,
        sequence: n,
        capturedAt: new Date(Date.now() - ageMs),
      },
    });
  }

  it("membuang titik tanpa perjalanan > 1 hari dan titik perjalanan > 14 hari, menyisakan yang baru", async () => {
    const { purgeOldDriverLocations } = await import(
      "../../src/modules/rides/application/rideLocationRetention.js"
    );
    const p = await profile();
    // Titik perjalanan butuh pesanan sungguhan agar kunci asing terpenuhi: pakai satu pesanan sederhana.
    const passenger = await prisma.user.create({
      data: {
        fullName: "Penumpang Retensi",
        email: `retensi-pax-${n}@example.invalid`,
        phone: `+6286${String(n).padStart(9, "0")}`,
        referralCode: `RTP${String(n).padStart(6, "0")}`,
        role: "USER",
      },
    });
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
        subtotalFare: 9000,
        totalFare: 9000,
        fareRuleVersion: "RIDE_FARE_RULE_V1",
        roundingRule: "ROUND_TO_NEAREST_100_HALF_UP",
        distanceSource: "HAVERSINE_LOCAL_V1",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const order = await prisma.rideOrder.create({
      data: {
        publicReference: `RID-RETENSI${n}`.slice(0, 24),
        passengerId: passenger.id,
        driverProfileId: p.id,
        quoteId: quote.id,
        serviceType: "MOTORCYCLE",
        status: "COMPLETED",
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
        completedAt: new Date(),
      },
    });

    const idleOld = await point(p.id, 2 * DAY);
    const idleFresh = await point(p.id, 2 * 60 * 60 * 1000);
    const rideOld = await point(p.id, 15 * DAY, order.id);
    const rideRecent = await point(p.id, 10 * DAY, order.id);

    const purged = await purgeOldDriverLocations(prisma);
    expect(purged).toBe(2);
    const left = (await prisma.rideDriverLocation.findMany({ select: { id: true } })).map((r) => r.id);
    expect(left.sort()).toEqual([idleFresh.id, rideRecent.id].sort());
    expect(left).not.toContain(idleOld.id);
    expect(left).not.toContain(rideOld.id);

    // Idempoten: putaran kedua tidak menghapus apa pun lagi.
    expect(await purgeOldDriverLocations(prisma)).toBe(0);
  });
});
