import { Prisma, RideOrderStatus, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;

describe.skipIf(!runIntegration)("Ride Chat API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-chat-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-chat-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("lets the passenger send and read a message on an active ride", async () => {
    const { passenger, driverUser, rideOrder } = await seedRideOrder("IN_TRIP");

    const send = await sendMessage(passenger, rideOrder.publicReference, "Saya di depan minimarket");
    expect(send.status).toBe(201);
    const sendBody = (await send.json()) as { data: { senderType: string; message: string } };
    expect(sendBody.data.senderType).toBe("USER");
    expect(sendBody.data.message).toBe("Saya di depan minimarket");

    const list = await listMessages(driverUser, rideOrder.publicReference);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: Array<{ message: string }> };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.message).toBe("Saya di depan minimarket");
  });

  it("lets the driver reply on the same ride", async () => {
    const { driverUser, rideOrder } = await seedRideOrder("DRIVER_ARRIVED");

    const send = await sendMessage(driverUser, rideOrder.publicReference, "Saya sudah sampai");
    expect(send.status).toBe(201);
    const body = (await send.json()) as { data: { senderType: string } };
    expect(body.data.senderType).toBe("DRIVER");
  });

  it("rejects a user who is not a participant of the ride, as 404 not 403", async () => {
    const { rideOrder } = await seedRideOrder("IN_TRIP");
    const stranger = await createUser("STRANGER1", "USER");

    const response = await sendMessage(stranger, rideOrder.publicReference, "halo");
    expect(response.status).toBe(404);
  });

  it("rejects chat before a driver is assigned", async () => {
    const { passenger, rideOrder } = await seedRideOrder("SEARCHING_DRIVER");

    const response = await sendMessage(passenger, rideOrder.publicReference, "halo");
    expect(response.status).toBe(409);
  });

  it("still allows chat shortly after completion but not after cancellation", async () => {
    const completed = await seedRideOrder("COMPLETED", "A");
    const completedResponse = await sendMessage(completed.passenger, completed.rideOrder.publicReference, "terima kasih");
    expect(completedResponse.status).toBe(201);

    const cancelled = await seedRideOrder("CANCELLED_BY_PASSENGER", "B");
    const cancelledResponse = await sendMessage(cancelled.passenger, cancelled.rideOrder.publicReference, "halo");
    expect(cancelledResponse.status).toBe(409);
  });

  it("marks the counterpart's messages as read, not the reader's own", async () => {
    const { passenger, driverUser, rideOrder } = await seedRideOrder("IN_TRIP");
    await sendMessage(passenger, rideOrder.publicReference, "dari penumpang");
    await sendMessage(driverUser, rideOrder.publicReference, "dari driver");

    const markRead = await api(`/api/v1/chat/rides/${rideOrder.publicReference}/read`, {
      method: "POST",
      token: tokenFor(passenger)
    });
    expect(markRead.status).toBe(200);
    const body = (await markRead.json()) as { data: { updated: number } };
    // Penumpang menandai terbaca hanya pesan driver (bukan pesannya sendiri).
    expect(body.data.updated).toBe(1);
  });

  it("rejects an empty message", async () => {
    const { passenger, rideOrder } = await seedRideOrder("IN_TRIP");
    const response = await sendMessage(passenger, rideOrder.publicReference, "   ");
    expect(response.status).toBe(400);
  });
});

function sendMessage(user: User, rideRef: string, message: string) {
  return api(`/api/v1/chat/rides/${rideRef}/messages`, {
    method: "POST",
    token: tokenFor(user),
    body: { message }
  });
}

function listMessages(user: User, rideRef: string) {
  return api(`/api/v1/chat/rides/${rideRef}/messages`, {
    token: tokenFor(user)
  });
}

async function seedRideOrder(status: RideOrderStatus, suffix = "1") {
  const passenger = await createUser(`CHATPASS${suffix}`, "USER");
  const driverUser = await createUser(`CHATDRV0${suffix}`, "USER");

  const driverProfile = await prisma.rideDriverProfile.create({
    data: { userId: driverUser.id, status: "ACTIVE", availability: "BUSY" }
  });

  const quote = await prisma.rideQuote.create({
    data: {
      userId: passenger.id,
      serviceType: "MOTORCYCLE",
      pickupLat: new Prisma.Decimal("-6.200000"),
      pickupLng: new Prisma.Decimal("106.816666"),
      pickupAddress: "Jl. Sudirman",
      dropoffLat: new Prisma.Decimal("-6.210000"),
      dropoffLng: new Prisma.Decimal("106.820000"),
      dropoffAddress: "Jl. Thamrin",
      distanceMeters: 3000,
      durationSeconds: 600,
      etaSeconds: 300,
      baseFare: 5000,
      distanceFare: 6000,
      serviceFee: 1000,
      subtotalFare: 11000,
      totalFare: 12000,
      fareRuleVersion: "test-v1",
      roundingRule: "none",
      distanceSource: "test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  const rideOrder = await prisma.rideOrder.create({
    data: {
      publicReference: `RID-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
      passengerId: passenger.id,
      driverProfileId: driverProfile.id,
      quoteId: quote.id,
      serviceType: "MOTORCYCLE",
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
      fareRuleVersion: quote.fareRuleVersion,
      paymentMethod: "CASH",
      paymentState: "CASH_EXPECTED"
    }
  });

  return { passenger, driverUser, driverProfile, rideOrder };
}

async function createUser(referralCode: string, role: UserRole): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function api(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}
