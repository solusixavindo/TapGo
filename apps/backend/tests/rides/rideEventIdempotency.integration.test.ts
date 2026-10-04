import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { PrismaClient, RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { RideService } from "../../src/modules/rides/application/RideService.js";

/**
 * Regresi dashboard Error & Bugs (4 Okt 2026), issue Sentry "Prisma error"
 * (TAPGO-BACKEND-2) pada POST /driver/rides/:ref/reject. Log produksi
 * membuktikan: `Invalid prisma.rideEvent.create() invocation: Unique constraint
 * failed on the fields: (event_key)`. Reject ganda memang idempoten dan
 * ditelan aplikasi, tetapi INSERT yang gagal tetap (1) dicatat mesin Prisma
 * sebagai event `error` yang diteruskan ke Sentry, dan (2) di dalam transaksi
 * PostgreSQL membatalkan seluruh transaksi sehingga pernyataan berikutnya gagal.
 * writeEvent kini memakai INSERT ... ON CONFLICT DO NOTHING.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

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

describeIntegration("Idempotensi event ride (writeEvent)", () => {
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
      if (!server) {
        resolve();
        return;
      }
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

  async function seedOfferAndDriver() {
    const passenger = await createUser("USER", "Sari Wulandari");
    const { user: driverUser, profile } = await createDriverWithVehicle();
    const order = await createOrder({ passengerId: passenger.id, status: "SEARCHING_DRIVER" });
    return { driverUser, profile, order };
  }

  it("reject ganda lewat API: keduanya 200 dan hanya satu event tersimpan", async () => {
    const { driverUser, profile, order } = await seedOfferAndDriver();
    const path = `/api/v1/driver/rides/${order.publicReference}/reject`;

    const first = await api(path, tokenFor(driverUser), { method: "POST" });
    const second = await api(path, tokenFor(driverUser), { method: "POST" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ rejected: true });
    const events = await prisma.rideEvent.findMany({
      where: { rideOrderId: order.id, type: "DRIVER_REJECTED_OFFER" }
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ driverProfileId: profile.id });
  });

  it("reject ganda tidak memicu event error mesin Prisma (yang diteruskan ke Sentry)", async () => {
    const { driverUser, order } = await seedOfferAndDriver();
    const logging = new PrismaClient({
      datasources: { db: { url: testDatabaseUrl! } },
      log: [{ emit: "event", level: "error" }]
    });
    const engineErrors: string[] = [];
    (logging as any).$on("error", (event: { message: string }) => engineErrors.push(event.message));
    try {
      const service = new RideService(logging, {} as never, {} as never);
      await service.rejectOffer({ userId: driverUser.id, publicReference: order.publicReference });
      await service.rejectOffer({ userId: driverUser.id, publicReference: order.publicReference });
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      await logging.$disconnect();
    }
    expect(engineErrors).toEqual([]);
  });

  it("event duplikat di dalam transaksi tidak membatalkan transaksi", async () => {
    const { order } = await seedOfferAndDriver();
    const service = new RideService(prisma, {} as never, {} as never) as any;
    const write = (tx: unknown) =>
      service.writeEvent(tx, {
        rideOrderId: order.id,
        type: "DRIVER_REJECTED_OFFER",
        actorRole: "DRIVER",
        eventKeySuffix: "driver-x"
      });

    const found = await prisma.$transaction(async (tx) => {
      await write(tx);
      await write(tx);
      // Sebelum perbaikan: "current transaction is aborted" (SQLSTATE 25P02).
      return tx.rideOrder.findUnique({ where: { id: order.id }, select: { id: true } });
    });

    expect(found?.id).toBe(order.id);
    expect(await prisma.rideEvent.count({ where: { rideOrderId: order.id } })).toBe(1);
  });
});
