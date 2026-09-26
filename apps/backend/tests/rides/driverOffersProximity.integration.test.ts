import { Prisma, RideOrderStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, seedMemberships, testDatabaseUrl, cleanDatabase } from "../helpers/referralWalletHarness.js";
import type { PushNotifier } from "../../src/modules/notifications/application/rideNotifications.js";
import type { PushMessage } from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Stage D2: tawaran berbasis jarak dan batas waktu pencarian.
 * Titik driver P = (-6.2000, 106.8166). 1 derajat lintang ~ 111,19 km.
 */
const P = { lat: -6.2, lng: 106.8166 };
const north = (km: number) => ({ lat: P.lat + km / 111.19, lng: P.lng });

class RecordingPush implements PushNotifier {
  enabled = true;
  sent: Array<{ userId: string; message: PushMessage }> = [];
  async notifyUser(userId: string, message: PushMessage) {
    this.sent.push({ userId, message });
  }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

let RideServiceClass: typeof import("../../src/modules/rides/application/RideService.js").RideService;
let expireStaleRideSearches: typeof import("../../src/modules/rides/application/rideSearchExpiry.js").expireStaleRideSearches;
let backendEnv: typeof import("../../src/config/env.js").env;
let sequence = 0;

function service(push?: PushNotifier) {
  return new RideServiceClass(prisma as never, {} as never, {} as never, undefined, push);
}

describe.skipIf(!runIntegration)("Tawaran berbasis jarak dan batas waktu pencarian (D2)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "offers-proximity-access-secret-0000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "offers-proximity-refresh-secret-000";
    backendEnv = (await import("../../src/config/env.js")).env;
    backendEnv.RIDE_OFFER_PROXIMITY_ENABLED = true;
    backendEnv.RIDE_OFFER_RADIUS_METERS = 5000;
    backendEnv.RIDE_SEARCH_TIMEOUT_SECONDS = 180;
    ({ RideService: RideServiceClass } = await import("../../src/modules/rides/application/RideService.js"));
    ({ expireStaleRideSearches } = await import("../../src/modules/rides/application/rideSearchExpiry.js"));
  });

  afterAll(() => {
    backendEnv.RIDE_OFFER_PROXIMITY_ENABLED = false;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    await prisma.rideEvent.deleteMany();
    await prisma.rideDriverLocation.deleteMany();
    await prisma.rideOrder.deleteMany();
    await prisma.rideQuote.deleteMany();
    await prisma.rideVehicle.deleteMany();
    await prisma.rideDriverProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createUser() {
    sequence += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: `User ${sequence}`,
        phone: `+6285${String(sequence).padStart(9, "0")}`,
        referralCode: `OFP${String(sequence).padStart(6, "0")}`,
        membershipId: basic.id
      }
    });
  }

  async function createDriver(fixAgeSeconds: number | null = 5) {
    const user = await createUser();
    const profile = await prisma.rideDriverProfile.create({
      data: { userId: user.id, status: "ACTIVE", availability: "ONLINE" }
    });
    await prisma.rideVehicle.create({
      data: {
        driverProfileId: profile.id,
        type: "MOTORCYCLE",
        plateNumberHash: createHash("sha256").update(`P${sequence}`).digest("hex"),
        plateNumberMasked: "B 12•• XX",
        verificationStatus: "VERIFIED",
        isActive: true
      }
    });
    if (fixAgeSeconds !== null) {
      await prisma.rideDriverLocation.create({
        data: {
          driverProfileId: profile.id,
          lat: new Prisma.Decimal(P.lat),
          lng: new Prisma.Decimal(P.lng),
          accuracyMeters: 10,
          sequence: sequence,
          capturedAt: new Date(Date.now() - fixAgeSeconds * 1000)
        }
      });
    }
    return { user, profile };
  }

  async function createOrder(pickup: { lat: number; lng: number }, options: { ageSeconds?: number; status?: RideOrderStatus; method?: "CASH" } = {}) {
    const passenger = await createUser();
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passenger.id,
        serviceType: "MOTORCYCLE",
        pickupLat: new Prisma.Decimal(pickup.lat.toFixed(7)),
        pickupLng: new Prisma.Decimal(pickup.lng.toFixed(7)),
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
    const order = await prisma.rideOrder.create({
      data: {
        publicReference: `RID-${String(sequence).replace(/\d/g, (d) => "ABCDEFGHJK".charAt(Number(d))).padStart(10, "M").slice(-10)}`,
        passengerId: passenger.id,
        quoteId: quote.id,
        serviceType: "MOTORCYCLE",
        status: options.status ?? "SEARCHING_DRIVER",
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
        paymentState: "CASH_EXPECTED",
        createdAt: new Date(Date.now() - (options.ageSeconds ?? 10) * 1000)
      }
    });
    return { order, passenger };
  }

  it("hanya menampilkan pesanan dalam radius, terdekat dulu, dengan jarak ke titik jemput", async () => {
    const { user } = await createDriver();
    const far = await createOrder(north(8));
    const edge = await createOrder(north(4.9));
    const near = await createOrder(north(2));
    const offers = (await service().listOffersForDriver(user.id)) as unknown as Array<{ reference: string; distanceToPickupMeters: number }>;
    expect(offers.map((o) => o.reference)).toEqual([near.order.publicReference, edge.order.publicReference]);
    expect(offers[0]!.distanceToPickupMeters).toBeGreaterThan(1800);
    expect(offers[0]!.distanceToPickupMeters).toBeLessThan(2200);
    expect(offers[1]!.distanceToPickupMeters).toBeLessThan(5000);
    expect(JSON.stringify(offers)).not.toContain(far.order.publicReference);
  });

  it("pesanan yang lebih tua dari batas waktu pencarian tidak tampil", async () => {
    const { user } = await createDriver();
    await createOrder(north(1), { ageSeconds: 240 });
    const fresh = await createOrder(north(1), { ageSeconds: 30 });
    const offers = (await service().listOffersForDriver(user.id)) as unknown as Array<{ reference: string }>;
    expect(offers.map((o) => o.reference)).toEqual([fresh.order.publicReference]);
  });

  it("tanpa posisi segar (kosong atau lebih tua dari 60 detik) tidak ada tawaran", async () => {
    const stale = await createDriver(120);
    const none = await createDriver(null);
    await createOrder(north(1));
    expect(await service().listOffersForDriver(stale.user.id)).toEqual([]);
    expect(await service().listOffersForDriver(none.user.id)).toEqual([]);
  });

  it("menerima pesanan dalam jangkauan berhasil; jauh ditolak; tanpa posisi ditolak; ulang oleh driver yang sama tetap sukses", async () => {
    const { user } = await createDriver();
    const near = await createOrder(north(2));
    const tooFar = await createOrder(north(6.9));
    const accepted = await service().acceptOrder({ userId: user.id, publicReference: near.order.publicReference });
    expect(accepted.status).toBe("DRIVER_ASSIGNED");

    await expect(service().acceptOrder({ userId: user.id, publicReference: tooFar.order.publicReference })).rejects.toMatchObject({ code: "RIDE_OFFER_OUT_OF_RANGE" });

    // Replay idempoten tetap sukses walau posisi sudah basi.
    await prisma.rideDriverLocation.deleteMany();
    const replay = await service().acceptOrder({ userId: user.id, publicReference: near.order.publicReference });
    expect(replay.status).toBe("DRIVER_ASSIGNED");

    const other = await createDriver(null);
    const another = await createOrder(north(1));
    await expect(service().acceptOrder({ userId: other.user.id, publicReference: another.order.publicReference })).rejects.toMatchObject({ code: "RIDE_DRIVER_LOCATION_REQUIRED" });
  });

  it("tawaran kedaluwarsa tidak dapat diterima", async () => {
    const { user } = await createDriver();
    const stale = await createOrder(north(1), { ageSeconds: 300 });
    await expect(service().acceptOrder({ userId: user.id, publicReference: stale.order.publicReference })).rejects.toMatchObject({ code: "RIDE_OFFER_EXPIRED" });
  });

  it("penyapu: pesanan tanpa driver lewat batas menjadi NO_DRIVER sekali, dengan event dan notifikasi ke penumpang", async () => {
    const stale = await createOrder(north(1), { ageSeconds: 300 });
    const fresh = await createOrder(north(1), { ageSeconds: 30 });
    const push = new RecordingPush();

    expect(await expireStaleRideSearches(prisma as never, push)).toBe(1);
    expect(await expireStaleRideSearches(prisma as never, push)).toBe(0);
    await flush();

    expect((await prisma.rideOrder.findUniqueOrThrow({ where: { id: stale.order.id } })).status).toBe("NO_DRIVER");
    expect((await prisma.rideOrder.findUniqueOrThrow({ where: { id: fresh.order.id } })).status).toBe("SEARCHING_DRIVER");
    const events = await prisma.rideEvent.findMany({ where: { rideOrderId: stale.order.id, type: "NO_DRIVER" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorRole).toBe("SYSTEM");
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.userId).toBe(stale.passenger.id);
    expect(push.sent[0]!.message.title).toBe("Driver belum ditemukan");
    expect(JSON.stringify(push.sent[0]!.message)).not.toContain("Titik jemput");
  });

  it("penyapu tidak menimpa pesanan yang sudah diterima driver (balapan)", async () => {
    const { user } = await createDriver();
    const order = await createOrder(north(1), { ageSeconds: 170 });
    await service().acceptOrder({ userId: user.id, publicReference: order.order.publicReference });
    await prisma.rideOrder.update({ where: { id: order.order.id }, data: { createdAt: new Date(Date.now() - 400_000) } });
    expect(await expireStaleRideSearches(prisma as never, new RecordingPush())).toBe(0);
    expect((await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.order.id } })).status).toBe("DRIVER_ASSIGNED");
  });

  it("proximity dimatikan: perilaku lama (semua pesanan sejenis tampil, tanpa posisi)", async () => {
    backendEnv.RIDE_OFFER_PROXIMITY_ENABLED = false;
    try {
      const { user } = await createDriver(null);
      const far = await createOrder(north(20));
      const offers = (await service().listOffersForDriver(user.id)) as unknown as Array<{ reference: string }>;
      expect(offers.map((o) => o.reference)).toEqual([far.order.publicReference]);
    } finally {
      backendEnv.RIDE_OFFER_PROXIMITY_ENABLED = true;
    }
  });

  it("pesanan baru: hanya driver ONLINE terdekat yang sesuai yang dapat push, tanpa alamat", async () => {
    const near = await createDriver();
    const far = await createDriver();
    await prisma.rideDriverLocation.updateMany({
      where: { driverProfileId: far.profile.id },
      data: { lat: new Prisma.Decimal(north(30).lat.toFixed(7)) }
    });
    const offline = await createDriver();
    await prisma.rideDriverProfile.update({ where: { id: offline.profile.id }, data: { availability: "OFFLINE" } });
    const stale = await createDriver(300);
    const passenger = await createUser();
    const pickup = north(1);
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passenger.id, serviceType: "MOTORCYCLE",
        pickupLat: new Prisma.Decimal(pickup.lat.toFixed(7)), pickupLng: new Prisma.Decimal(pickup.lng.toFixed(7)),
        pickupAddress: "Jalan Rahasia 1", dropoffLat: new Prisma.Decimal("-6.1000000"), dropoffLng: new Prisma.Decimal("106.9000000"),
        dropoffAddress: "Tujuan", distanceMeters: 3000, durationSeconds: 600, etaSeconds: 300,
        baseFare: 5000, distanceFare: 3000, serviceFee: 1000, subtotalFare: 9000, totalFare: 9000,
        fareRuleVersion: "RIDE_FARE_RULE_V1", roundingRule: "ROUND_TO_NEAREST_100_HALF_UP", distanceSource: "HAVERSINE_LOCAL_V1",
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });
    const push = new RecordingPush();
    await service(push).createOrder({ userId: passenger.id, quoteId: quote.id, paymentMethod: "CASH" });
    await flush();
    expect(push.sent.map((p) => p.userId)).toEqual([near.user.id]);
    expect(push.sent[0]!.message.data?.type).toBe("ride_offer");
    expect(JSON.stringify(push.sent[0]!.message)).not.toContain("Rahasia");
    expect([far.user.id, offline.user.id, stale.user.id]).not.toContain(push.sent[0]!.userId);
  });

  it("penumpang membatalkan pesanan yang sudah diterima: driver mendapat push", async () => {
    const { user } = await createDriver();
    const { order, passenger } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    const push = new RecordingPush();
    await service(push).cancelByPassenger({ userId: passenger.id, publicReference: order.publicReference, reason: "CHANGE_OF_PLAN" });
    await flush();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.userId).toBe(user.id);
    expect(push.sent[0]!.message.data?.type).toBe("ride_cancelled");
  });
});
