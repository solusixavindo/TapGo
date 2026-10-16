import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { RideDriverAvailability, RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";
import { DriverIncentiveService, wibDay } from "../../src/modules/rides/application/DriverIncentiveService.js";


let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;
let sequence = 0;

type ApiResponse = { status: number; raw: string; body: any };

async function api(path: string, token?: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) }
  });
  const raw = await response.text();
  return { status: response.status, raw, body: raw ? JSON.parse(raw) : {} };
}

const REFERENCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";
function makeReference(): string {
  sequence += 1;
  let suffix = "";
  let value = sequence;
  for (let index = 0; index < 10; index += 1) {
    suffix += REFERENCE_CHARS[value % REFERENCE_CHARS.length];
    value = Math.floor(value / REFERENCE_CHARS.length) + index + 7;
  }
  return `RID-${suffix}`;
}

async function createUser(role: UserRole = "USER", fullName?: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: fullName ?? `Penumpang ${sequence}`,
      phone: `08${String(500000000 + sequence)}`,
      referralCode: `DPD${String(sequence).padStart(6, "0")}`,
      role
    }
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `sess-${user.id}`,
    authVersion: 0
  });
}

async function createDriverWithVehicle(fullName = "Dedi Kurniawan") {
  const user = await createUser("USER", fullName);
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "BUSY" }
  });
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: `hash-${profile.id.slice(0, 12)}`,
      plateNumberMasked: "B 1234 XYZ",
      brand: "Honda",
      model: "Vario 160",
      color: "Hitam",
      verificationStatus: "VERIFIED",
      isActive: true
    }
  });
  return { user, profile, vehicle };
}

const PICKUP_LAT = "-6.2000000";
const PICKUP_LNG = "106.8166660";
const DROPOFF_LAT = "-6.2100000";
const DROPOFF_LNG = "106.8266660";

async function createOrder(options: {
  passengerId: string;
  status: RideOrderStatus;
  driverProfileId?: string;
  vehicleId?: string;
  assignedAt?: Date | null;
}) {
  sequence += 1;
  const quote = await prisma.rideQuote.create({
    data: {
      userId: options.passengerId,
      serviceType: "MOTORCYCLE",
      pickupLat: PICKUP_LAT, pickupLng: PICKUP_LNG, pickupAddress: "Titik jemput uji",
      dropoffLat: DROPOFF_LAT, dropoffLng: DROPOFF_LNG, dropoffAddress: "Titik tujuan uji",
      distanceMeters: 1500, durationSeconds: 600, etaSeconds: 300,
      baseFare: 5000, distanceFare: 6000, serviceFee: 1000,
      subtotalFare: 12000, totalFare: 12000,
      fareRuleVersion: "test", roundingRule: "test", distanceSource: "test",
      expiresAt: new Date(Date.now() + 600_000)
    }
  });
  return prisma.rideOrder.create({
    data: {
      publicReference: makeReference(),
      passengerId: options.passengerId,
      quoteId: quote.id,
      serviceType: "MOTORCYCLE",
      status: options.status,
      pickupLat: quote.pickupLat, pickupLng: quote.pickupLng, pickupAddress: quote.pickupAddress,
      dropoffLat: quote.dropoffLat, dropoffLng: quote.dropoffLng, dropoffAddress: quote.dropoffAddress,
      distanceMeters: quote.distanceMeters, durationSeconds: quote.durationSeconds,
      baseFare: quote.baseFare, distanceFare: quote.distanceFare, serviceFee: quote.serviceFee,
      subtotalFare: quote.subtotalFare, totalFare: quote.totalFare,
      fareRuleVersion: quote.fareRuleVersion,
      ...(options.driverProfileId ? { driverProfileId: options.driverProfileId } : {}),
      ...(options.vehicleId ? { vehicleId: options.vehicleId } : {}),
      ...(options.assignedAt !== undefined
        ? { assignedAt: options.assignedAt }
        : options.driverProfileId
          ? { assignedAt: new Date() }
          : {})
    }
  });
}



const describeIntegration = runIntegration ? describe : describe.skip;

const DAY = 86_400_000;
const NOW = new Date("2026-10-16T05:00:00.000Z"); // 12:00 WIB, 16 Okt 2026
const DAY_KEY = "2026-10-16";

describe("wibDay", () => {
  it("memotong hari pada 00:00 WIB (17:00 UTC hari sebelumnya)", () => {
    const before = wibDay(new Date("2026-10-16T16:59:59.000Z"));
    const after = wibDay(new Date("2026-10-16T17:00:00.000Z"));
    expect(before.key).toBe("2026-10-16");
    expect(after.key).toBe("2026-10-17");
    expect(after.start.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    expect(after.end.toISOString()).toBe("2026-10-17T17:00:00.000Z");
  });
});

type Driver = Awaited<ReturnType<typeof createDriverWithVehicle>>;

describeIntegration("insentif harian driver", () => {
  /** Masa tahan 0 jam: klaim langsung jatuh tempo. Uji masa tahan memakai layanan terpisah (holdHours 24). */
  const service = (holdHours = 0) => new DriverIncentiveService(prisma, holdHours);

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.apiRateLimiter.resetKey(key);
      limiters.rideWriteRateLimiter.resetKey(key);
      limiters.adminRateLimiter.resetKey(key);
    }
  });

  async function admin(role: UserRole = "SUPER_ADMIN") {
    return createUser(role, `Admin ${role}`);
  }

  async function makeRule(overrides: Partial<{
    name: string; targetTrips: number; bonusAmount: number; minTripFare: number;
    dailyBudget: number | null; startsAt: Date | null; endsAt: Date | null; isActive: boolean;
  }> = {}) {
    const actor = await admin();
    return prisma.driverIncentiveRule.create({
      data: {
        name: overrides.name ?? "Target 3 perjalanan",
        targetTrips: overrides.targetTrips ?? 3,
        bonusAmount: overrides.bonusAmount ?? 20000,
        minTripFare: overrides.minTripFare ?? 0,
        dailyBudget: overrides.dailyBudget ?? null,
        startsAt: overrides.startsAt ?? null,
        endsAt: overrides.endsAt ?? null,
        isActive: overrides.isActive ?? true,
        createdById: actor.id
      }
    });
  }

  /** Penumpang sah: akun lama dan terverifikasi. */
  async function legitPassenger(name?: string) {
    const user = await createUser("USER", name);
    return prisma.user.update({
      where: { id: user.id },
      data: { createdAt: new Date(NOW.getTime() - 30 * DAY), emailVerifiedAt: new Date(NOW.getTime() - 29 * DAY) }
    });
  }

  let tripSeq = 0;
  /** Satu perjalanan selesai yang LOLOS semua syarat keras (kecuali diubah lewat opsi). */
  async function addTrip(
    driver: Driver,
    options: {
      passenger?: { id: string };
      completedAt?: Date;
      totalFare?: number;
      minutes?: number;
      moveDegrees?: number | null;
      samples?: number;
      sameRoute?: boolean;
      paymentState?: "DIGITAL_REFUNDED";
    } = {}
  ) {
    tripSeq += 1;
    const passenger = options.passenger ?? (await legitPassenger());
    const completedAt = options.completedAt ?? NOW;
    const startedAt = new Date(completedAt.getTime() - (options.minutes ?? 10) * 60_000);
    const order = await createOrder({
      passengerId: passenger.id,
      status: "COMPLETED",
      driverProfileId: driver.profile.id,
      vehicleId: driver.vehicle.id
    });
    const lat = options.sameRoute ? -6.2 : -6.2 - tripSeq * 0.02;
    await prisma.rideOrder.update({
      where: { id: order.id },
      data: {
        completedAt,
        startedAt,
        totalFare: options.totalFare ?? 12000,
        pickupLat: lat,
        pickupLng: 106.8,
        dropoffLat: lat - 0.01,
        dropoffLng: 106.81,
        ...(options.paymentState ? { paymentState: options.paymentState } : {})
      }
    });
    const move = options.moveDegrees === undefined ? 0.005 : options.moveDegrees;
    const samples = options.samples ?? 3;
    if (move !== null) {
      for (let i = 0; i < samples; i += 1) {
        await prisma.rideDriverLocation.create({
          data: {
            driverProfileId: driver.profile.id,
            rideOrderId: order.id,
            lat: lat + (i * move) / Math.max(1, samples - 1),
            lng: 106.8,
            accuracyMeters: 10,
            sequence: tripSeq * 10 + i,
            capturedAt: new Date(startedAt.getTime() + 60_000 * (i + 1))
          }
        });
      }
    }
    return { order, passenger };
  }

  async function addTrips(driver: Driver, count: number, options: Parameters<typeof addTrip>[1] = {}) {
    for (let i = 0; i < count; i += 1) await addTrip(driver, options);
  }

  const claims = () => prisma.driverIncentiveClaim.findMany({ orderBy: { createdAt: "asc" } });
  const balanceOf = async (userId: string) => Number((await prisma.wallet.findUnique({ where: { userId } }))?.balance ?? 0);

  describe("alur uang: klaim, masa tahan, verifikasi ulang, pencairan", () => {
    it("target tercapai membuat klaim PENDING TANPA menggerakkan uang; dicairkan sekali setelah jatuh tempo", async () => {
      const driver = await createDriverWithVehicle();
      const rule = await makeRule();
      await addTrips(driver, 2);
      expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);
      await addTrip(driver);
      expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(1);
      expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);

      const [claim] = await claims();
      expect(claim).toMatchObject({ status: "PENDING", ruleId: rule.id, dayKey: DAY_KEY, tripCount: 3 });
      expect(await prisma.wallet.count({ where: { userId: driver.user.id } })).toBe(0);

      expect(await service().settleDueClaims(NOW)).toBe(1);
      expect(await service().settleDueClaims(NOW)).toBe(0);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.user.id } });
      expect(Number(wallet.balance)).toBe(20000);
      expect(Number(wallet.cashBalance)).toBe(20000);
      const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ type: "INCENTIVE_BONUS", referenceType: "DRIVER_INCENTIVE" });
      expect((await claims())[0]).toMatchObject({ status: "PAID" });
    });

    it("masa tahan 24 jam: belum cair sebelum jatuh tempo, cair sesudahnya", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 3);
      await service(24).evaluateForDriver(driver.profile.id, driver.user.id, NOW);
      expect(await service(24).settleDueClaims(new Date(NOW.getTime() + 23 * 3600_000))).toBe(0);
      expect(await balanceOf(driver.user.id)).toBe(0);
      expect(await service(24).settleDueClaims(new Date(NOW.getTime() + 25 * 3600_000))).toBe(1);
      expect(await balanceOf(driver.user.id)).toBe(20000);
    });

    it("verifikasi ulang: perjalanan yang dananya dikembalikan sebelum pencairan membuat klaim DITOLAK, uang tidak bergerak", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 3);
      await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW);
      await prisma.rideOrder.updateMany({ where: { driverProfileId: driver.profile.id }, data: { paymentState: "DIGITAL_REFUNDED" } });
      expect(await service().settleDueClaims(NOW)).toBe(0);
      expect((await claims())[0]).toMatchObject({ status: "REJECTED" });
      expect(await prisma.wallet.count({ where: { userId: driver.user.id } })).toBe(0);
    });

    it("progres: klaim menunggu tampil dengan jumlahnya; setelah cair berstatus PAID", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 4);
      const waiting = await service(24).progressForDriver(driver.profile.id, driver.user.id, NOW);
      expect(waiting.items[0]).toMatchObject({ tripCount: 3, claimStatus: "PENDING", claimed: false, bonusAmount: 20000 });
      expect(waiting.waiting).toEqual({ count: 1, amount: 20000 });
      expect(waiting.holdHours).toBe(24);

      const paid = await service(24).progressForDriver(driver.profile.id, driver.user.id, new Date(NOW.getTime() + 25 * 3600_000));
      expect(paid.waiting).toEqual({ count: 0, amount: 0 });
      expect(await balanceOf(driver.user.id)).toBe(20000);
    });

    it("perjalanan kemarin (WIB) dan tarif di bawah minimum tidak dihitung", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule({ minTripFare: 10000 });
      await addTrip(driver, { completedAt: new Date("2026-10-15T16:59:00.000Z") }); // 15 Okt 23:59 WIB
      await addTrip(driver, { completedAt: new Date("2026-10-16T17:01:00.000Z") }); // 17 Okt 00:01 WIB
      await addTrips(driver, 3, { totalFare: 5000 });
      await addTrips(driver, 2, { totalFare: 10000 });
      const progress = await service().progressForDriver(driver.profile.id, driver.user.id, NOW);
      expect(progress.dayKey).toBe(DAY_KEY);
      expect(progress.items[0]).toMatchObject({ tripCount: 2, targetTrips: 3, claimStatus: null });
      expect(await claims()).toHaveLength(0);
    });

    it("aturan nonaktif, belum mulai, atau sudah berakhir tidak membuat klaim", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule({ name: "nonaktif", isActive: false });
      await makeRule({ name: "belum", startsAt: new Date("2026-10-17T00:00:00.000Z") });
      await makeRule({ name: "usai", endsAt: new Date("2026-10-16T04:00:00.000Z") });
      await addTrips(driver, 5);
      expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);
      expect((await service().progressForDriver(driver.profile.id, driver.user.id, NOW)).items).toEqual([]);
    });

    it("anggaran harian dicadangkan saat klaim dibuat: hanya yang muat, termasuk driver yang mencapai target bersamaan", async () => {
      await makeRule({ bonusAmount: 20000, dailyBudget: 60000 });
      const drivers: Driver[] = [];
      for (let i = 0; i < 5; i += 1) {
        const driver = await createDriverWithVehicle(`Driver ${i}`);
        await addTrips(driver, 3);
        drivers.push(driver);
      }
      await Promise.all(drivers.map((d) => service().evaluateForDriver(d.profile.id, d.user.id, NOW)));
      const all = await claims();
      expect(all).toHaveLength(3);
      const claimedProfiles = new Set(all.map((c) => c.driverProfileId));
      const loser = drivers.find((d) => !claimedProfiles.has(d.profile.id))!;
      const progress = await service().progressForDriver(loser.profile.id, loser.user.id, NOW);
      expect(progress.items[0]).toMatchObject({ claimStatus: null, budgetExhausted: true });
    });

    it("evaluasi paralel untuk driver yang sama membuat tepat satu klaim dan satu pencairan", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 3);
      await Promise.all(Array.from({ length: 6 }, () => service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)));
      expect(await claims()).toHaveLength(1);
      await Promise.all(Array.from({ length: 6 }, () => service().settleDueClaims(NOW)));
      expect(await balanceOf(driver.user.id)).toBe(20000);
      expect(await prisma.walletTransaction.count({ where: { type: "INCENTIVE_BONUS" } })).toBe(1);
    });

    it("endpoint driver: selesai perjalanan membuat klaim (bukan uang); setelah jatuh tempo cair dan tampil di riwayat saldo", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule({ targetTrips: 1, bonusAmount: 15000 });
      const passenger = await legitPassenger();
      const order = await createOrder({
        passengerId: passenger.id,
        status: "IN_TRIP",
        driverProfileId: driver.profile.id,
        vehicleId: driver.vehicle.id
      });
      await prisma.rideOrder.update({ where: { id: order.id }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
      for (let i = 0; i < 3; i += 1) {
        await prisma.rideDriverLocation.create({
          data: { driverProfileId: driver.profile.id, rideOrderId: order.id, lat: -6.2 + i * 0.004, lng: 106.8, accuracyMeters: 10, sequence: i, capturedAt: new Date(Date.now() - 9 * 60_000 + i * 60_000) }
        });
      }
      const before = await api("/api/v1/driver/incentives", tokenFor(driver.user));
      expect(before.status).toBe(200);
      expect(before.body.data.items[0]).toMatchObject({ tripCount: 0, claimStatus: null });

      const done = await api(`/api/v1/driver/rides/${order.publicReference}/complete`, tokenFor(driver.user), { method: "POST" });
      expect(done.status).toBe(200);
      for (let i = 0; i < 40 && (await prisma.driverIncentiveClaim.count()) === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await claims()).toHaveLength(1);
      expect(await prisma.wallet.count({ where: { userId: driver.user.id, balance: { gt: 0 } } })).toBe(0);
      const waiting = await api("/api/v1/driver/incentives", tokenFor(driver.user));
      expect(waiting.body.data.items[0]).toMatchObject({ tripCount: 1, claimStatus: "PENDING" });
      expect(waiting.body.data.waiting).toEqual({ count: 1, amount: 15000 });

      // Jatuh tempo: majukan jam klaim lalu cairkan lewat penyapu berkala.
      await prisma.driverIncentiveClaim.updateMany({ data: { settleAfter: new Date(Date.now() - 1000) } });
      expect(await service().settleDueClaims(new Date())).toBe(1);
      const wallet = await api("/api/v1/driver/wallet", tokenFor(driver.user));
      expect(wallet.body.data.balance).toBe(15000);
      expect(wallet.body.data.entries).toEqual([expect.objectContaining({ kind: "INCENTIVE", amount: 15000 })]);
    });

    it("bukan driver ditolak", async () => {
      const passenger = await createUser("USER");
      expect((await api("/api/v1/driver/incentives", tokenFor(passenger))).status).toBe(403);
    });
  });

  describe("pengaman kecurangan: syarat keras (perjalanan tidak dihitung)", () => {
    async function counted(driver: Driver, targetTrips = 50) {
      await makeRule({ targetTrips: Math.min(targetTrips, 100) });
      const progress = await service().progressForDriver(driver.profile.id, driver.user.id, NOW);
      return progress.items[0]!.tripCount;
    }

    it("diselesaikan seketika (< 3 menit) atau tanpa waktu mulai tidak dihitung", async () => {
      const driver = await createDriverWithVehicle();
      await addTrip(driver);
      await addTrip(driver, { minutes: 0.5 });
      const passenger = await legitPassenger();
      const order = await createOrder({ passengerId: passenger.id, status: "COMPLETED", driverProfileId: driver.profile.id, vehicleId: driver.vehicle.id });
      await prisma.rideOrder.update({ where: { id: order.id }, data: { completedAt: NOW, startedAt: null, totalFare: 12000 } });
      expect(await counted(driver)).toBe(1);
    });

    it("tanpa jejak GPS, jejak terlalu sedikit, atau driver tidak bergerak tidak dihitung", async () => {
      const driver = await createDriverWithVehicle();
      await addTrip(driver);
      await addTrip(driver, { moveDegrees: null }); // tidak ada titik sama sekali
      await addTrip(driver, { samples: 1 }); // satu titik
      await addTrip(driver, { moveDegrees: 0.0005 }); // ~55 m: duduk di tempat
      expect(await counted(driver)).toBe(1);
    });

    it("satu penumpang dihitung sekali per hari walau memesan berkali-kali", async () => {
      const driver = await createDriverWithVehicle();
      const rider = await legitPassenger("Pemesan Berulang");
      await addTrips(driver, 5, { passenger: rider });
      await makeRule({ targetTrips: 3 });
      expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);
      expect((await service().progressForDriver(driver.profile.id, driver.user.id, NOW)).items[0]).toMatchObject({ tripCount: 1 });
    });

    it("penumpang langganan (>= 3 perjalanan dengan driver ini dalam 6 hari sebelumnya) tidak dihitung", async () => {
      const driver = await createDriverWithVehicle();
      const regular = await legitPassenger("Langganan");
      for (const daysAgo of [1, 2, 3]) await addTrip(driver, { passenger: regular, completedAt: new Date(NOW.getTime() - daysAgo * DAY) });
      await addTrip(driver, { passenger: regular });
      await addTrip(driver);
      expect(await counted(driver)).toBe(1);
    });

    it("penumpang yang berbagi perangkat dengan akun driver tidak dihitung", async () => {
      const driver = await createDriverWithVehicle();
      await prisma.pushToken.create({ data: { userId: driver.user.id, platform: "android", token: "tok-driver", deviceId: "dev-sama" } });
      await addTrip(driver);
      const own = await legitPassenger("Akun Kedua Driver");
      await prisma.pushToken.create({ data: { userId: own.id, platform: "android", token: "tok-own", deviceId: "dev-sama" } });
      await addTrip(driver, { passenger: own });
      expect(await counted(driver)).toBe(1);
    });

    it("beberapa akun penumpang pada SATU perangkat dihitung satu (juga berantai)", async () => {
      const driver = await createDriverWithVehicle();
      const [a, b, c] = [await legitPassenger("A"), await legitPassenger("B"), await legitPassenger("C")];
      await prisma.pushToken.create({ data: { userId: a.id, platform: "android", token: "t-a", deviceId: "hp-1" } });
      await prisma.pushToken.create({ data: { userId: b.id, platform: "android", token: "t-b1", deviceId: "hp-1" } });
      await prisma.pushToken.create({ data: { userId: b.id, platform: "android", token: "t-b2", deviceId: "hp-2" } });
      await prisma.pushToken.create({ data: { userId: c.id, platform: "android", token: "t-c", deviceId: "hp-2" } });
      for (const p of [a, b, c]) await addTrip(driver, { passenger: p });
      await addTrip(driver);
      expect(await counted(driver)).toBe(2); // A-B-C satu kelompok + satu penumpang lain
    });

    it("sponsor atau downline referral driver tidak dihitung sebagai penumpang", async () => {
      const driver = await createDriverWithVehicle();
      const downline = await legitPassenger("Downline");
      const upline = await legitPassenger("Upline");
      await prisma.referral.create({ data: { sponsorId: driver.user.id, userId: downline.id } });
      await prisma.referral.create({ data: { sponsorId: upline.id, userId: driver.user.id } });
      await addTrip(driver, { passenger: downline });
      await addTrip(driver, { passenger: upline });
      await addTrip(driver);
      expect(await counted(driver)).toBe(1);
    });

    it("perjalanan yang dananya sudah dikembalikan tidak dihitung", async () => {
      const driver = await createDriverWithVehicle();
      await addTrip(driver);
      await addTrip(driver, { paymentState: "DIGITAL_REFUNDED" });
      expect(await counted(driver)).toBe(1);
    });
  });

  describe("pengaman kecurangan: tanda kecurigaan (klaim ditahan untuk tinjauan admin)", () => {
    async function flagsAfter(setup: (driver: Driver) => Promise<void>, targetTrips = 3) {
      const driver = await createDriverWithVehicle();
      await makeRule({ targetTrips });
      await setup(driver);
      await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW);
      const claim = (await claims()).find((c) => c.dayKey === DAY_KEY);
      return { driver, claim };
    }

    it("mayoritas penumpang akun baru (< 72 jam)", async () => {
      const { claim } = await flagsAfter(async (driver) => {
        for (let i = 0; i < 3; i += 1) {
          const fresh = await createUser("USER");
          await prisma.user.update({ where: { id: fresh.id }, data: { createdAt: new Date(NOW.getTime() - 3600_000), emailVerifiedAt: NOW } });
          await addTrip(driver, { passenger: fresh });
        }
      });
      expect(claim).toMatchObject({ status: "REVIEW" });
      expect(claim!.flags).toContain("NEW_ACCOUNTS");
    });

    it("mayoritas penumpang belum terverifikasi", async () => {
      const { claim } = await flagsAfter(async (driver) => {
        for (let i = 0; i < 3; i += 1) {
          const old = await createUser("USER");
          await prisma.user.update({ where: { id: old.id }, data: { createdAt: new Date(NOW.getTime() - 30 * DAY) } });
          await addTrip(driver, { passenger: old });
        }
      });
      expect(claim).toMatchObject({ status: "REVIEW" });
      expect(claim!.flags).toContain("UNVERIFIED_PASSENGERS");
    });

    it("rute yang sama berulang", async () => {
      const { claim } = await flagsAfter(async (driver) => {
        await addTrips(driver, 3, { sameRoute: true });
      });
      expect(claim).toMatchObject({ status: "REVIEW" });
      expect(claim!.flags).toContain("SAME_ROUTE");
    });

    it("driver yang pernah punya klaim ditolak atau ditarik kembali", async () => {
      const { claim } = await flagsAfter(async (driver) => {
        const rule = await makeRule({ name: "lama" });
        await prisma.driverIncentiveClaim.create({
          data: {
            ruleId: rule.id, driverProfileId: driver.profile.id, userId: driver.user.id, dayKey: "2026-10-10", tripCount: 3,
            amount: 20000, status: "REJECTED", settleAfter: NOW, countedOrderIds: []
          }
        });
        await addTrips(driver, 3);
      });
      expect(claim).toMatchObject({ status: "REVIEW" });
      expect(claim!.flags).toContain("PRIOR_FRAUD");
    });

    it("klaim REVIEW tidak pernah cair otomatis, walau lewat masa tahan", async () => {
      const { driver } = await flagsAfter(async (d) => {
        await addTrips(d, 3, { sameRoute: true });
      });
      expect(await service().settleDueClaims(new Date(NOW.getTime() + 10 * DAY))).toBe(0);
      expect(await balanceOf(driver.user.id)).toBe(0);
    });

    it("tanda baru yang muncul saat verifikasi ulang memindahkan klaim PENDING ke REVIEW", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 3);
      await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW);
      expect((await claims())[0]).toMatchObject({ status: "PENDING" });
      // Sesudah klaim dibuat, driver ternyata punya riwayat klaim ditolak di rule lain.
      const other = await makeRule({ name: "lain" });
      await prisma.driverIncentiveClaim.create({
        data: { ruleId: other.id, driverProfileId: driver.profile.id, userId: driver.user.id, dayKey: "2026-10-12", tripCount: 3, amount: 1000, status: "REVERSED", settleAfter: NOW, countedOrderIds: [] }
      });
      expect(await service().settleDueClaims(NOW)).toBe(0);
      const held = (await claims()).find((c) => c.dayKey === DAY_KEY)!;
      expect(held.status).toBe("REVIEW");
      expect(await balanceOf(driver.user.id)).toBe(0);
    });
  });

  describe("tinjauan admin: setujui, tolak, tarik kembali", () => {
    const send = (token: string, method: string, path: string, body?: unknown) =>
      api(`/api/v1/admin/driver-incentives${path}`, token, {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });

    async function reviewClaim() {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 3, { sameRoute: true });
      await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW);
      const [claim] = await claims();
      expect(claim!.status).toBe("REVIEW");
      return { driver, claim: claim! };
    }

    it("Super Admin melihat daftar, menyetujui klaim REVIEW: dibayar sekali, tercatat di audit", async () => {
      const { driver, claim } = await reviewClaim();
      const boss = await admin("SUPER_ADMIN");
      const list = await send(tokenFor(boss), "GET", "/claims");
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([expect.objectContaining({ id: claim.id, status: "REVIEW", flags: ["SAME_ROUTE"], amount: 20000 })]);
      expect(list.body.data[0].driver.fullName).toContain("Dedi");

      const approved = await send(tokenFor(boss), "POST", `/claims/${claim.id}/approve`, { note: "Rute memang sama: ojek kantor" });
      expect(approved.status).toBe(200);
      expect(approved.body.data.status).toBe("PAID");
      expect(await balanceOf(driver.user.id)).toBe(20000);
      const again = await send(tokenFor(boss), "POST", `/claims/${claim.id}/approve`, {});
      expect(again.status).toBe(409);
      expect(await balanceOf(driver.user.id)).toBe(20000);
      const audit = await prisma.auditLog.findMany({ where: { entityType: "DriverIncentiveClaim" } });
      expect(audit.map((a) => a.action)).toEqual(["DRIVER_INCENTIVE_CLAIM_APPROVED"]);
    });

    it("persetujuan admin tetap memeriksa syarat keras: perjalanan yang sudah dikembalikan membuat klaim ditolak", async () => {
      const { driver, claim } = await reviewClaim();
      await prisma.rideOrder.updateMany({ where: { driverProfileId: driver.profile.id }, data: { paymentState: "DIGITAL_REFUNDED" } });
      const boss = await admin("SUPER_ADMIN");
      const response = await send(tokenFor(boss), "POST", `/claims/${claim.id}/approve`, {});
      expect(response.body.data.status).toBe("REJECTED");
      expect(await balanceOf(driver.user.id)).toBe(0);
    });

    it("menolak klaim butuh alasan; klaim yang ditolak tidak dapat dibayar", async () => {
      const { driver, claim } = await reviewClaim();
      const boss = tokenFor(await admin("SUPER_ADMIN"));
      expect((await send(boss, "POST", `/claims/${claim.id}/reject`, {})).status).toBe(400);
      const rejected = await send(boss, "POST", `/claims/${claim.id}/reject`, { note: "Pesanan rekayasa" });
      expect(rejected.body.data.status).toBe("REJECTED");
      expect((await send(boss, "POST", `/claims/${claim.id}/approve`, {})).status).toBe(409);
      expect(await service().settleDueClaims(new Date(NOW.getTime() + 10 * DAY))).toBe(0);
      expect(await balanceOf(driver.user.id)).toBe(0);
    });

    it("tarik kembali bonus yang sudah dibayar: saldo berkurang sekali; gagal bila saldo tidak cukup", async () => {
      const driver = await createDriverWithVehicle();
      await makeRule();
      await addTrips(driver, 3);
      await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW);
      await service().settleDueClaims(NOW);
      const [claim] = await claims();
      expect(claim!.status).toBe("PAID");
      const boss = tokenFor(await admin("SUPER_ADMIN"));

      // Driver sudah memakai/menarik sebagian: saldo yang dapat ditarik kurang dari bonus.
      await prisma.wallet.update({ where: { userId: driver.user.id }, data: { cashBalance: 5000, balance: 5000 } });
      const blocked = await send(boss, "POST", `/claims/${claim!.id}/reverse`, { note: "Terbukti curang" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe("INCENTIVE_REVERSE_INSUFFICIENT");
      expect((await claims())[0]!.status).toBe("PAID");

      await prisma.wallet.update({ where: { userId: driver.user.id }, data: { cashBalance: 50000, balance: 50000 } });
      const done = await send(boss, "POST", `/claims/${claim!.id}/reverse`, { note: "Terbukti curang" });
      expect(done.body.data.status).toBe("REVERSED");
      expect(await balanceOf(driver.user.id)).toBe(30000);
      const again = await send(boss, "POST", `/claims/${claim!.id}/reverse`, { note: "Terbukti curang" });
      expect(again.status).toBe(409);
      expect(await balanceOf(driver.user.id)).toBe(30000);
    });

    it("Admin biasa dan driver ditolak pada semua aksi klaim", async () => {
      const { claim } = await reviewClaim();
      const regular = tokenFor(await admin("ADMIN"));
      const driverToken = tokenFor((await createDriverWithVehicle("Driver Lain")).user);
      for (const token of [regular, driverToken]) {
        expect((await send(token, "GET", "/claims")).status).toBe(403);
        expect((await send(token, "POST", `/claims/${claim.id}/approve`, {})).status).toBe(403);
        expect((await send(token, "POST", `/claims/${claim.id}/reject`, { note: "x yz" })).status).toBe(403);
        expect((await send(token, "POST", `/claims/${claim.id}/reverse`, { note: "x yz" })).status).toBe(403);
      }
    });
  });

  describe("pengelolaan aturan oleh admin", () => {
    const send = (token: string, method: string, path: string, body?: unknown) =>
      api(`/api/v1/admin/driver-incentives${path}`, token, {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });

    it("Super Admin membuat, mengubah, menonaktifkan; semuanya tercatat di audit", async () => {
      const boss = await admin("SUPER_ADMIN");
      const token = tokenFor(boss);
      const created = await send(token, "POST", "", { name: "Rajin", targetTrips: 5, bonusAmount: 30000, minTripFare: 8000, dailyBudget: 300000 });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;

      const edited = await send(token, "PATCH", `/${id}`, { bonusAmount: 35000 });
      expect(edited.status).toBe(200);
      expect(edited.body.data.bonusAmount).toBe(35000);
      const off = await send(token, "PATCH", `/${id}`, { isActive: false });
      expect(off.body.data.isActive).toBe(false);

      const list = await send(token, "GET", "");
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ name: "Rajin", paidTodayCount: 0, isActive: false });
      const audit = await prisma.auditLog.findMany({ where: { entityType: "DriverIncentiveRule" }, orderBy: { createdAt: "asc" } });
      expect(audit.map((a) => a.action)).toEqual([
        "DRIVER_INCENTIVE_RULE_CREATED",
        "DRIVER_INCENTIVE_RULE_UPDATED",
        "DRIVER_INCENTIVE_RULE_UPDATED"
      ]);
      expect(audit.every((a) => a.actorId === boss.id)).toBe(true);
    });

    it("Admin biasa dan driver ditolak; nilai tidak masuk akal ditolak", async () => {
      const regular = await admin("ADMIN");
      expect((await send(tokenFor(regular), "GET", "")).status).toBe(403);
      expect((await send(tokenFor(regular), "POST", "", { name: "x", targetTrips: 1, bonusAmount: 5000 })).status).toBe(403);
      const driver = await createDriverWithVehicle();
      expect((await send(tokenFor(driver.user), "GET", "")).status).toBe(403);

      const boss = tokenFor(await admin("SUPER_ADMIN"));
      for (const bad of [
        { name: "", targetTrips: 3, bonusAmount: 20000 },
        { name: "a", targetTrips: 0, bonusAmount: 20000 },
        { name: "a", targetTrips: 101, bonusAmount: 20000 },
        { name: "a", targetTrips: 3, bonusAmount: 500 },
        { name: "a", targetTrips: 3, bonusAmount: 9_000_000 },
        { name: "a", targetTrips: 3, bonusAmount: 20000, dailyBudget: 5000 }
      ]) {
        expect((await send(boss, "POST", "", bad)).status).toBe(400);
      }
      expect(await prisma.driverIncentiveRule.count()).toBe(0);
    });

    it("batas jumlah aturan aktif dijaga", async () => {
      const boss = tokenFor(await admin("SUPER_ADMIN"));
      for (let i = 0; i < 10; i += 1) {
        expect((await send(boss, "POST", "", { name: `Aturan ${i}`, targetTrips: i + 1, bonusAmount: 10000 })).status).toBe(201);
      }
      const extra = await send(boss, "POST", "", { name: "Kelebihan", targetTrips: 11, bonusAmount: 10000 });
      expect(extra.status).toBe(409);
      expect(extra.body.code).toBe("INCENTIVE_TOO_MANY_ACTIVE_RULES");
    });
  });
});
