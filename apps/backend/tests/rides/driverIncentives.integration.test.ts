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

describeIntegration("insentif harian driver", () => {
  const service = () => new DriverIncentiveService(prisma);

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

  async function completedTrips(
    driver: { profile: { id: string }; vehicle: { id: string } },
    count: number,
    completedAt: Date,
    totalFare = 12000
  ) {
    for (let i = 0; i < count; i += 1) {
      const passenger = await createUser("USER");
      const order = await createOrder({
        passengerId: passenger.id,
        status: "COMPLETED",
        driverProfileId: driver.profile.id,
        vehicleId: driver.vehicle.id
      });
      await prisma.rideOrder.update({ where: { id: order.id }, data: { completedAt, totalFare } });
    }
  }

  const NOW = new Date("2026-10-16T05:00:00.000Z"); // 12:00 WIB

  it("bonus dibayar sekali saat target tercapai: saldo dapat ditarik + catatan buku saldo", async () => {
    const driver = await createDriverWithVehicle();
    const rule = await makeRule();
    await completedTrips(driver, 2, NOW);
    expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);
    expect(await prisma.driverIncentiveClaim.count()).toBe(0);

    await completedTrips(driver, 1, NOW);
    expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(1);
    // Evaluasi ulang tidak membayar lagi.
    expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.user.id } });
    expect(Number(wallet.balance)).toBe(20000);
    expect(Number(wallet.cashBalance)).toBe(20000);
    const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "INCENTIVE_BONUS", referenceType: "DRIVER_INCENTIVE" });
    expect(ledger[0]!.metadata).toMatchObject({ ruleId: rule.id, dayKey: "2026-10-16", tripCount: 3 });
  });

  it("perjalanan kemarin (WIB) dan tarif di bawah minimum tidak dihitung", async () => {
    const driver = await createDriverWithVehicle();
    await makeRule({ minTripFare: 10000 });
    // 17:00 UTC = 00:00 WIB hari berikutnya: perjalanan 16:59 UTC masih hari yang sama (16 Okt), 17:01 hari berikutnya.
    await completedTrips(driver, 1, new Date("2026-10-15T16:59:00.000Z")); // 15 Okt 23:59 WIB
    await completedTrips(driver, 1, new Date("2026-10-16T17:01:00.000Z")); // 17 Okt 00:01 WIB
    await completedTrips(driver, 3, NOW, 5000); // terlalu murah
    await completedTrips(driver, 2, NOW, 10000); // tepat minimum: dihitung

    const progress = await service().progressForDriver(driver.profile.id, driver.user.id, NOW);
    expect(progress.dayKey).toBe("2026-10-16");
    expect(progress.items).toHaveLength(1);
    expect(progress.items[0]).toMatchObject({ tripCount: 2, targetTrips: 3, claimed: false });
    expect(await prisma.driverIncentiveClaim.count()).toBe(0);
  });

  it("progres menyelesaikan klaim yang tertinggal dan menandainya terklaim", async () => {
    const driver = await createDriverWithVehicle();
    await makeRule();
    await completedTrips(driver, 4, NOW);
    const progress = await service().progressForDriver(driver.profile.id, driver.user.id, NOW);
    expect(progress.items[0]).toMatchObject({ tripCount: 3, claimed: true, bonusAmount: 20000 });
    expect(await prisma.driverIncentiveClaim.count()).toBe(1);
  });

  it("aturan nonaktif, belum mulai, atau sudah berakhir tidak membayar", async () => {
    const driver = await createDriverWithVehicle();
    await makeRule({ name: "nonaktif", isActive: false });
    await makeRule({ name: "belum", startsAt: new Date("2026-10-17T00:00:00.000Z") });
    await makeRule({ name: "usai", endsAt: new Date("2026-10-16T04:00:00.000Z") });
    await completedTrips(driver, 5, NOW);
    expect(await service().evaluateForDriver(driver.profile.id, driver.user.id, NOW)).toBe(0);
    const progress = await service().progressForDriver(driver.profile.id, driver.user.id, NOW);
    expect(progress.items).toEqual([]);
  });

  it("anggaran harian: hanya bonus yang muat yang dibayar, termasuk saat driver mencapai target bersamaan", async () => {
    await makeRule({ bonusAmount: 20000, dailyBudget: 60000 });
    const drivers = [];
    for (let i = 0; i < 5; i += 1) {
      const driver = await createDriverWithVehicle(`Driver ${i}`);
      await completedTrips(driver, 3, NOW);
      drivers.push(driver);
    }
    await Promise.all(drivers.map((d) => service().evaluateForDriver(d.profile.id, d.user.id, NOW)));
    const claims = await prisma.driverIncentiveClaim.aggregate({ _sum: { amount: true }, _count: { _all: true } });
    expect(claims._count._all).toBe(3);
    expect(Number(claims._sum.amount)).toBe(60000);

    const loser = await Promise.all(
      drivers.map(async (d) => ({
        d,
        claimed: (await prisma.driverIncentiveClaim.count({ where: { driverProfileId: d.profile.id } })) > 0
      }))
    ).then((rows) => rows.find((r) => !r.claimed)!.d);
    const progress = await service().progressForDriver(loser.profile.id, loser.user.id, NOW);
    expect(progress.items[0]).toMatchObject({ claimed: false, budgetExhausted: true });
  });

  it("evaluasi paralel untuk driver yang sama membayar tepat sekali", async () => {
    const driver = await createDriverWithVehicle();
    await makeRule();
    await completedTrips(driver, 3, NOW);
    await Promise.all(
      Array.from({ length: 6 }, () => service().evaluateForDriver(driver.profile.id, driver.user.id, NOW))
    );
    expect(await prisma.driverIncentiveClaim.count()).toBe(1);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver.user.id } });
    expect(Number(wallet.balance)).toBe(20000);
  });

  it("endpoint driver: GET /driver/incentives memuat progres; selesai perjalanan memicu bonus", async () => {
    const driver = await createDriverWithVehicle();
    await makeRule({ targetTrips: 1, bonusAmount: 15000 });
    const passenger = await createUser("USER");
    const order = await createOrder({
      passengerId: passenger.id,
      status: "IN_TRIP",
      driverProfileId: driver.profile.id,
      vehicleId: driver.vehicle.id
    });
    const before = await api("/api/v1/driver/incentives", tokenFor(driver.user));
    expect(before.status).toBe(200);
    expect(before.body.data.items[0]).toMatchObject({ tripCount: 0, claimed: false });

    const done = await api(`/api/v1/driver/rides/${order.publicReference}/complete`, tokenFor(driver.user), { method: "POST" });
    expect(done.status).toBe(200);
    // Evaluasi berjalan di latar belakang setelah commit.
    for (let i = 0; i < 40 && (await prisma.driverIncentiveClaim.count()) === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await prisma.driverIncentiveClaim.count()).toBe(1);
    const after = await api("/api/v1/driver/incentives", tokenFor(driver.user));
    expect(after.body.data.items[0]).toMatchObject({ tripCount: 1, claimed: true });
  });

  it("bukan driver ditolak", async () => {
    const passenger = await createUser("USER");
    expect((await api("/api/v1/driver/incentives", tokenFor(passenger))).status).toBe(403);
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
