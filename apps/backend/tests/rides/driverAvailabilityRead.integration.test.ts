import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { RideDriverAvailability, RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";

/**
 * GET /driver/availability — uji HP driver +7 (4 Okt 2026): kartu beranda
 * menampilkan "Offline" setelah aplikasi dibuka ulang padahal server ONLINE,
 * dan tetap "Dalam Perjalanan" setelah perjalanan selesai. Penyebab: tidak ada
 * jalur BACA availability; klien hanya memegangnya di memori. Endpoint ini
 * hanya MEMBACA profil dari database — tidak boleh menulis apa pun (onlineSince
 * dan verifikasi wajah tidak boleh ikut terpengaruh).
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

describeIntegration("GET /driver/availability", () => {
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

  async function driverWith(availability: RideDriverAvailability, extra: object = {}) {
    const { user, profile } = await createDriverWithVehicle();
    await prisma.rideDriverProfile.update({
      where: { id: profile.id },
      data: { availability, ...extra },
    });
    return { user, profile };
  }

  it.each(["ONLINE", "OFFLINE", "BUSY"] as const)("mengembalikan %s dari database", async (value) => {
    const { user } = await driverWith(value);
    const response = await api("/api/v1/driver/availability", tokenFor(user));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ availability: value });
  });

  it("hanya membaca: tidak menulis availability, onlineSince, atau lastSeenAt", async () => {
    const onlineSince = new Date(Date.now() - 3_600_000);
    const lastSeenAt = new Date(Date.now() - 600_000);
    const { user, profile } = await driverWith("ONLINE", { onlineSince, lastSeenAt });
    await api("/api/v1/driver/availability", tokenFor(user));
    await api("/api/v1/driver/availability", tokenFor(user));
    const after = await prisma.rideDriverProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after.availability).toBe("ONLINE");
    expect(after.onlineSince?.getTime()).toBe(onlineSince.getTime());
    expect(after.lastSeenAt?.getTime()).toBe(lastSeenAt.getTime());
  });

  it("tanpa token: 401", async () => {
    const response = await api("/api/v1/driver/availability");
    expect(response.status).toBe(401);
  });

  it("akun tanpa profil driver: ditolak oleh guard kapabilitas yang sama dengan POST", async () => {
    const user = await createUser("USER", "Bukan Driver");
    const response = await api("/api/v1/driver/availability", tokenFor(user));
    expect(response.status).toBe(403);
  });

  it("driver SUSPENDED ditolak (guard kapabilitas), bukan membocorkan availability", async () => {
    const { user, profile } = await driverWith("ONLINE");
    await prisma.rideDriverProfile.update({ where: { id: profile.id }, data: { status: "SUSPENDED" } });
    const response = await api("/api/v1/driver/availability", tokenFor(user));
    expect(response.status).toBe(403);
  });
});
