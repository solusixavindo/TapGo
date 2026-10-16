import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { RideDriverAvailability, RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";


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

/**
 * Pembatalan tidak dikenai biaya uang, jadi pesan-lalu-batal (penumpang) dan terima-lalu-batal (driver) dijeda setelah
 * RIDE_LATE_CANCEL_LIMIT kali dalam 24 jam, selama RIDE_LATE_CANCEL_COOLDOWN_MINUTES.
 */
describeIntegration("jeda pembatalan berulang", () => {
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
    }
  });

  const MIN = 60_000;

  async function cancelled(passengerId: string, count: number, minutesAgo: number, extra: Record<string, unknown>) {
    for (let i = 0; i < count; i += 1) {
      const order = await createOrder({ passengerId, status: "CANCELLED_BY_PASSENGER", ...(extra.driverProfileId ? { driverProfileId: extra.driverProfileId as string } : {}) });
      await prisma.rideOrder.update({
        where: { id: order.id },
        data: { cancelledAt: new Date(Date.now() - minutesAgo * MIN - i * 1000), ...extra } as never
      });
    }
  }

  async function freshQuote(userId: string) {
    return prisma.rideQuote.create({
      data: {
        userId, serviceType: "MOTORCYCLE",
        pickupLat: "-6.2000000", pickupLng: "106.8166660", pickupAddress: "Jemput",
        dropoffLat: "-6.2100000", dropoffLng: "106.8266660", dropoffAddress: "Tujuan",
        distanceMeters: 1500, durationSeconds: 600, etaSeconds: 300,
        baseFare: 5000, distanceFare: 6000, serviceFee: 1000, subtotalFare: 12000, totalFare: 12000,
        fareRuleVersion: "test", roundingRule: "test", distanceSource: "test",
        expiresAt: new Date(Date.now() + 600_000)
      }
    });
  }

  const order = (token: string, quoteId: string) =>
    api("/api/v1/rides", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId, paymentMethod: "CASH" })
    });

  it("penumpang dengan 3 pembatalan terlambat dalam 24 jam dijeda; setelah jeda boleh lagi", async () => {
    const passenger = await createUser("USER", "Pengerjai");
    const driver = await createDriverWithVehicle();
    await cancelled(passenger.id, 3, 5, { cancellationFee: 2000, driverProfileId: driver.profile.id });
    const quote = await freshQuote(passenger.id);
    const blocked = await order(tokenFor(passenger), quote.id);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RIDE_PASSENGER_CANCEL_COOLDOWN");
    expect(await prisma.rideOrder.count({ where: { passengerId: passenger.id, status: "SEARCHING_DRIVER" } })).toBe(0);

    // Pembatalan terakhir sudah lewat 31 menit: jeda selesai.
    await prisma.rideOrder.updateMany({ where: { passengerId: passenger.id }, data: { cancelledAt: new Date(Date.now() - 31 * MIN) } });
    expect((await order(tokenFor(passenger), quote.id)).status).toBe(201);
  });

  it("pembatalan tanpa driver (tanpa biaya) atau hanya 2 kali tidak memicu jeda", async () => {
    const passenger = await createUser("USER", "Wajar");
    const driver = await createDriverWithVehicle();
    await cancelled(passenger.id, 2, 5, { cancellationFee: 2000, driverProfileId: driver.profile.id });
    await cancelled(passenger.id, 5, 5, { cancellationFee: 0 }); // dibatalkan sebelum ada driver
    const quote = await freshQuote(passenger.id);
    expect((await order(tokenFor(passenger), quote.id)).status).toBe(201);
  });

  it("pembatalan lebih dari 24 jam lalu tidak dihitung", async () => {
    const passenger = await createUser("USER", "Lama");
    const driver = await createDriverWithVehicle();
    await cancelled(passenger.id, 4, 25 * 60, { cancellationFee: 2000, driverProfileId: driver.profile.id });
    const quote = await freshQuote(passenger.id);
    expect((await order(tokenFor(passenger), quote.id)).status).toBe(201);
  });

  it("driver dengan 3 pembatalan setelah menerima dalam 24 jam dijeda menerima pesanan", async () => {
    const driver = await createDriverWithVehicle();
    for (let i = 0; i < 3; i += 1) {
      const passenger = await createUser("USER");
      const o = await createOrder({ passengerId: passenger.id, status: "CANCELLED_BY_DRIVER", driverProfileId: driver.profile.id, vehicleId: driver.vehicle.id });
      await prisma.rideOrder.update({ where: { id: o.id }, data: { cancelledAt: new Date(Date.now() - (5 + i) * MIN) } });
    }
    await prisma.rideDriverProfile.update({ where: { id: driver.profile.id }, data: { availability: "ONLINE" } });
    const blocked = await api("/api/v1/driver/rides/RID-ABCDEFGHJK/accept", tokenFor(driver.user), { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RIDE_DRIVER_CANCEL_COOLDOWN");

    await prisma.rideOrder.updateMany({ where: { driverProfileId: driver.profile.id }, data: { cancelledAt: new Date(Date.now() - 40 * MIN) } });
    const allowed = await api("/api/v1/driver/rides/RID-ABCDEFGHJK/accept", tokenFor(driver.user), { method: "POST" });
    expect(allowed.status).not.toBe(429);
  });
});
