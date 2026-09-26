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

describe.skipIf(!runIntegration)("Komisi pesanan tunai dari saldo driver (D4)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "offers-proximity-access-secret-0000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "offers-proximity-refresh-secret-000";
    backendEnv = (await import("../../src/config/env.js")).env;
    backendEnv.RIDE_OFFER_PROXIMITY_ENABLED = false;
    ({ RideService: RideServiceClass } = await import("../../src/modules/rides/application/RideService.js"));
    ({ expireStaleRideSearches } = await import("../../src/modules/rides/application/rideSearchExpiry.js"));
  });

  afterAll(() => {
    backendEnv.DRIVER_COMMISSION_ENABLED = false;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.DRIVER_COMMISSION_ENABLED = true;
    backendEnv.DRIVER_COMMISSION_PERCENT = 8;
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

  async function fund(userId: string, amount: number) {
    await prisma.wallet.upsert({
      where: { userId },
      update: { balance: amount, cashBalance: amount },
      create: { userId, balance: amount, cashBalance: amount }
    });
  }
  const walletOf = (userId: string) => prisma.wallet.findUniqueOrThrow({ where: { userId } });
  async function drive(userId: string, reference: string) {
    for (const next of ["DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_TRIP", "COMPLETED"] as const) {
      await service().advanceByDriver({ userId, publicReference: reference, next });
    }
  }

  it("saldo kurang: pesanan tunai ditolak dengan 402 dan pesan jelas; pesanan tetap terbuka", async () => {
    const { user } = await createDriver();
    await fund(user.id, 500);
    const { order } = await createOrder(north(1));
    await expect(service().acceptOrder({ userId: user.id, publicReference: order.publicReference })).rejects.toMatchObject({
      code: "RIDE_COMMISSION_BALANCE_INSUFFICIENT",
      statusCode: 402
    });
    expect((await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SEARCHING_DRIVER");
  });

  it("driver tanpa dompet sama sekali juga ditolak", async () => {
    const { user } = await createDriver();
    const { order } = await createOrder(north(1));
    await expect(service().acceptOrder({ userId: user.id, publicReference: order.publicReference })).rejects.toMatchObject({
      code: "RIDE_COMMISSION_BALANCE_INSUFFICIENT"
    });
  });

  it("saldo cukup: selesai memotong 8% (dibulatkan ke atas) tepat sekali; ledger debit; saldo berkurang", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1)); // tarif 9000 -> komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    // ulang penyelesaian (idempoten) tidak memotong lagi
    await service().advanceByDriver({ userId: user.id, publicReference: order.publicReference, next: "COMPLETED" });

    const wallet = await walletOf(user.id);
    expect(wallet.balance.toNumber()).toBe(9_280);
    expect(wallet.cashBalance.toNumber()).toBe(9_280);
    const rows = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount.toNumber()).toBe(-720);
    expect(rows[0]!.referenceId).toBe(order.id);
    expect((rows[0]!.metadata as { shortfall: string }).shortfall).toBe("0");
    expect(await prisma.commission.count()).toBe(0);
  });

  it("pembulatan ke atas: tarif 9050 -> 724", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1));
    await prisma.rideOrder.update({ where: { id: order.id }, data: { totalFare: 9050 } });
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000 - 724);
  });

  it("saldo ditarik saat perjalanan: dipotong sebatas saldo tersedia, selisih dicatat, saldo tidak negatif", async () => {
    const { user } = await createDriver();
    await fund(user.id, 1_000);
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await prisma.wallet.update({ where: { userId: user.id }, data: { balance: 300, cashBalance: 300 } });
    await drive(user.id, order.publicReference);
    const wallet = await walletOf(user.id);
    expect(wallet.balance.toNumber()).toBe(0);
    expect(wallet.cashBalance.toNumber()).toBe(0);
    const row = await prisma.walletTransaction.findFirstOrThrow({ where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" } });
    expect(row.amount.toNumber()).toBe(-300);
    expect((row.metadata as { shortfall: string }).shortfall).toBe("420");
  });

  it("pesanan dibatalkan driver tidak dikenai komisi", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await service().cancelByDriver({ userId: user.id, publicReference: order.publicReference, reason: "OTHER" });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000);
    expect(await prisma.walletTransaction.count({ where: { referenceType: "RIDE_COMMISSION_FEE" } })).toBe(0);
  });

  it("flag mati: perilaku lama — tanpa dompet pun bisa terima, tidak ada potongan", async () => {
    backendEnv.DRIVER_COMMISSION_ENABLED = false;
    const { user } = await createDriver();
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  it("ringkasan saldo driver: saldo, aturan komisi, riwayat komisi dan isi saldo", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const wallet = await walletOf(user.id);
    await prisma.walletTransaction.create({ data: { walletId: wallet.id, type: "TOPUP", amount: 10_000, referenceType: "WALLET_TOPUP", referenceId: "x" } });
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    const summary = await service().walletSummary(user.id);
    expect(summary.balance).toBe(9_280);
    expect(summary.commissionEnabled).toBe(true);
    expect(summary.commissionPercent).toBe(8);
    const fee = summary.entries.find((e) => e.kind === "COMMISSION")!;
    expect(fee.amount).toBe(-720);
    expect(fee.rideReference).toBe(order.publicReference);
    expect(fee.shortfall).toBe(0);
    expect(summary.entries.some((e) => e.kind === "TOPUP" && e.amount === 10_000)).toBe(true);
  });

  it("ringkasan saldo untuk driver tanpa dompet: nol dan riwayat kosong", async () => {
    const { user } = await createDriver();
    expect(await service().walletSummary(user.id)).toMatchObject({ balance: 0, entries: [] });
  });
});
