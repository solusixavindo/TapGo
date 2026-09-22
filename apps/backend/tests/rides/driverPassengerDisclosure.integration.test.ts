import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";
import {
  GENERIC_PASSENGER_NAME,
  toPassengerDisplayName
} from "../../src/modules/rides/application/driverPassengerDisclosure.js";

/**
 * Arah sebaliknya dari passengerDriverDisclosure.integration.test.ts —
 * pengungkapan identitas PENUMPANG kepada driver, plus koordinat jemput/
 * tujuan yang sebelumnya tidak pernah dikirim ke driver_app sama sekali
 * (lihat plan "Menuju Jemput map parity").
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

describeIntegration("Driver <- passenger disclosure & koordinat jemput/tujuan", () => {
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

  it("driver melihat koordinat jemput/tujuan dan nama depan penumpang pada perjalanan aktif", async () => {
    const passenger = await createUser("USER", "Sari Wulandari");
    const { user: driverUser, profile, vehicle } = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "DRIVER_TO_PICKUP",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const response = await api("/api/v1/driver/rides/current", tokenFor(driverUser));

    expect(response.status).toBe(200);
    expect(response.body.data.pickup).toEqual({ lat: -6.2, lng: 106.816666 });
    expect(response.body.data.dropoff).toEqual({ lat: -6.21, lng: 106.826666 });
    expect(response.body.data.passenger).toEqual({ displayName: "Sari" });
    expect(order.status).toBe("DRIVER_TO_PICKUP");
  });

  it("riwayat dan perjalanan aktif memakai kontrak yang sama untuk field passenger/koordinat", async () => {
    const passenger = await createUser("USER", "Joko Prasetyo");
    const { user: driverUser, profile, vehicle } = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "DRIVER_ARRIVED",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const token = tokenFor(driverUser);
    const current = await api("/api/v1/driver/rides/current", token);
    const history = await api("/api/v1/driver/rides/history", token);

    const historyItem = (history.body.data as Array<Record<string, any>>).find(
      (row) => row.reference === order.publicReference
    );
    expect(historyItem).toBeDefined();
    expect(historyItem!.passenger).toEqual(current.body.data.passenger);
    expect(historyItem!.pickup).toEqual(current.body.data.pickup);
    expect(historyItem!.dropoff).toEqual(current.body.data.dropoff);
  });

  it("order yang belum ditugaskan tidak membocorkan identitas penumpang", async () => {
    const passenger = await createUser("USER", "Rina Marlina");
    const { user: driverUser, profile, vehicle } = await createDriverWithVehicle();
    // Order milik driver LAIN yang belum di-assign -> tidak muncul di
    // current/history driver ini sama sekali (difilter oleh driverProfileId),
    // jadi pengujian gating dilakukan lewat status pembatalan SEBELUM
    // assignment, yang tetap dimiliki driver ini (driverProfileId null).
    await createOrder({ passengerId: passenger.id, status: "SEARCHING_DRIVER" });

    const empty = await api("/api/v1/driver/rides/current", tokenFor(driverUser));
    expect(empty.body.data).toBeNull();
    // Vehicle dibuat supaya kapabilitas driver terverifikasi di beforeEach lain.
    expect(vehicle.driverProfileId).toBe(profile.id);
  });

  it("nomor telepon dan email penumpang tidak pernah ada di respons driver", async () => {
    const passenger = await createUser("USER", "Wahyu Setiawan");
    const { user: driverUser, profile, vehicle } = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "IN_TRIP",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const current = await api("/api/v1/driver/rides/current", tokenFor(driverUser));
    const history = await api("/api/v1/driver/rides/history", tokenFor(driverUser));

    for (const payload of [current.raw, history.raw]) {
      expect(payload).not.toContain(passenger.phone);
      expect(payload).not.toContain("Setiawan");
      expect(payload).not.toContain(passenger.id);
    }
    expect(order.pickupAddress).toBe("Titik jemput uji");
  });

  it("nama kosong/tak wajar menghasilkan label generik, bukan string mentah", () => {
    expect(toPassengerDisplayName("Sari Wulandari")).toBe("Sari");
    expect(toPassengerDisplayName("  Joko   Prasetyo  ")).toBe("Joko");
    for (const invalid of ["", "   ", "***", null, undefined, 42 as never]) {
      expect(toPassengerDisplayName(invalid as string | null)).toBe(GENERIC_PASSENGER_NAME);
    }
  });
});
