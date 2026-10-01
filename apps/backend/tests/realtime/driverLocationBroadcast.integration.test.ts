import { Prisma, RideOrderStatus, RideServiceType, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import http, { Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import type { Server as IoServer } from "socket.io";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Audit keamanan 30 September 2026 (L2): driver:location sekarang memakai
 * resolveParticipant yang sama dengan ride:join — hanya DRIVER ride yang
 * bersangkutan yang boleh menyiarkan lokasinya, room dituju lewat
 * rideOrderId hasil resolusi (bukan string mentah dari klien), dan payload
 * yang diteruskan disaring ke field geo yang dikenal saja.
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let httpServer: HttpServer | undefined;
let realtime: IoServer | null = null;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;
const openClients: ClientSocket[] = [];

describe.skipIf(!runIntegration)("L2 — driver:location authorization & payload hygiene", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "driver-location-broadcast-access-secret-0000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "driver-location-broadcast-refresh-secret-000";

    const [{ createApp }, envMod, { attachRealtime }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/config/env.js"),
      import("../../src/realtime/socket.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    Object.assign(envMod.env, { REALTIME_ENABLED: true });
    signAccessToken = tokenService.signAccessToken;

    httpServer = http.createServer(createApp());
    realtime = attachRealtime(httpServer);
    await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanTables();
  });

  afterEach(() => {
    for (const client of openClients.splice(0)) {
      client.close();
    }
  });

  afterAll(async () => {
    if (realtime) {
      realtime.close();
      realtime = null;
    }
    if (httpServer) {
      await new Promise<void>((resolve, reject) => httpServer!.close((error) => (error ? reject(error) : resolve())));
      httpServer = undefined;
    }
  });

  it("driver ride ini menyiarkan lokasi, penumpang ride ini menerimanya dengan rideId hasil resolusi", async () => {
    const driver = await createDriver();
    const order = await createRideOrder(driver, "IN_TRIP");

    const driverClient = await connect(tokenFor(driver.user));
    const passengerClient = await connect(tokenFor(order.passenger));

    await joinRoom(passengerClient, order.publicReference);

    const received = waitForEvent<{ rideId: string; lat: number; lng: number }>(
      passengerClient,
      "driver:location:update"
    );
    driverClient.emit("driver:location", { rideId: order.publicReference, lat: -6.2, lng: 106.8 });

    const payload = await received;
    expect(payload.rideId).toBe(order.id);
    expect(payload.lat).toBe(-6.2);
    expect(payload.lng).toBe(106.8);
  });

  it("payload yang diterima TIDAK PERNAH memuat field selain yang diketahui (mis. token)", async () => {
    const driver = await createDriver();
    const order = await createRideOrder(driver, "IN_TRIP");

    const driverClient = await connect(tokenFor(driver.user));
    const passengerClient = await connect(tokenFor(order.passenger));
    await joinRoom(passengerClient, order.publicReference);

    const received = waitForEvent<Record<string, unknown>>(passengerClient, "driver:location:update");
    driverClient.emit("driver:location", {
      rideId: order.publicReference,
      lat: -6.1,
      lng: 106.1,
      token: "should-never-be-forwarded",
      extraField: "should-never-be-forwarded-either"
    });

    const payload = await received;
    expect(Object.keys(payload).sort()).toEqual(["heading", "lat", "lng", "rideId", "speed"]);
    expect(JSON.stringify(payload)).not.toContain("should-never-be-forwarded");
  });

  it("penumpang yang mencoba menyiarkan 'lokasi driver' ditolak diam-diam (tidak ada broadcast)", async () => {
    const driver = await createDriver();
    const order = await createRideOrder(driver, "IN_TRIP");

    const passengerAsBroadcaster = await connect(tokenFor(order.passenger));
    const passengerListener = await connect(tokenFor(order.passenger));
    await joinRoom(passengerListener, order.publicReference);

    const received = waitForEvent<unknown>(passengerListener, "driver:location:update", 500).then(
      () => "received",
      () => "timeout"
    );
    passengerAsBroadcaster.emit("driver:location", { rideId: order.publicReference, lat: -6.3, lng: 106.9 });

    expect(await received).toBe("timeout");
  });

  it("bukan partisipan ride ini tidak dapat memicu broadcast apa pun", async () => {
    const driver = await createDriver();
    const order = await createRideOrder(driver, "IN_TRIP");
    const stranger = await createUser("USER");

    const strangerClient = await connect(tokenFor(stranger));
    const passengerListener = await connect(tokenFor(order.passenger));
    await joinRoom(passengerListener, order.publicReference);

    const received = waitForEvent<unknown>(passengerListener, "driver:location:update", 500).then(
      () => "received",
      () => "timeout"
    );
    strangerClient.emit("driver:location", { rideId: order.publicReference, lat: -6.4, lng: 107.0 });

    expect(await received).toBe("timeout");
  });
});

function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      auth: { token }
    });
    openClients.push(client);
    client.on("connect", () => resolve(client));
    client.on("connect_error", (error) => reject(error));
    setTimeout(() => reject(new Error("connect timeout")), 2000);
  });
}

function joinRoom(client: ClientSocket, rideRef: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit("ride:join", rideRef, (result: { ok: boolean; error?: string }) => {
      if (result.ok) resolve();
      else reject(new Error(result.error ?? "join failed"));
    });
    setTimeout(() => reject(new Error("join timeout")), 2000);
  });
}

function waitForEvent<T>(client: ClientSocket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function cleanTables() {
  await prisma.auditLog.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Driver Location Broadcast User ${sequence}`,
      email: `driver-location-broadcast-${sequence}@example.invalid`,
      phone: `+6287${String(sequence).padStart(9, "0")}`,
      referralCode: `DLB${String(sequence).padStart(7, "0")}`,
      role
    }
  });
}

async function createDriver() {
  const user = await createUser("USER");
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "ONLINE" }
  });
  sequence += 1;
  const rawPlate = `B ${String(sequence).padStart(4, "0")} DLB`;
  const plateHash = createHash("sha256").update(rawPlate).digest("hex");
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: plateHash,
      plateNumberMasked: "B 12•• DLB",
      verificationStatus: "VERIFIED",
      isActive: true
    }
  });
  return { user, profile, vehicle };
}

async function createRideOrder(
  driver: Awaited<ReturnType<typeof createDriver>>,
  status: RideOrderStatus,
  serviceType: RideServiceType = "MOTORCYCLE"
) {
  const passenger = await createUser("USER");
  const quote = await prisma.rideQuote.create({
    data: {
      userId: passenger.id,
      serviceType,
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
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  sequence += 1;
  const order = await prisma.rideOrder.create({
    data: {
      publicReference: `RID-${String(sequence).replace(/\d/g, (d) => "ABCDEFGHJK".charAt(Number(d))).padStart(10, "M").slice(-10)}`,
      passengerId: passenger.id,
      driverProfileId: driver.profile.id,
      vehicleId: driver.vehicle.id,
      assignedAt: new Date(Date.now() - 120_000),
      arrivedAt: new Date(Date.now() - 90_000),
      startedAt: new Date(Date.now() - 60_000),
      quoteId: quote.id,
      serviceType,
      status,
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
      fareRuleVersion: quote.fareRuleVersion
    }
  });
  return { ...order, passenger };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `driver-location-broadcast-${user.id}`
  });
}
