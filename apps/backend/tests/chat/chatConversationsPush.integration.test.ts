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
import { ChatService, chatCanSend } from "../../src/modules/chat/application/ChatService.js";
import type { PushNotifier } from "../../src/modules/notifications/application/rideNotifications.js";
import type { PushMessage } from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Chat penumpang-driver: notifikasi pesan baru, jendela balas/baca setelah
 * perjalanan selesai, dan kotak masuk dengan hitungan pesan belum dibaca.
 */
class RecordingPush implements PushNotifier {
  enabled = true;
  failWith: Error | null = null;
  sent: Array<{ userId: string; message: PushMessage }> = [];
  async notifyUser(userId: string, message: PushMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ userId, message });
  }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
const HOUR = 60 * 60 * 1000;

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;

describe("chatCanSend (jendela balas)", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  it("aktif selama perjalanan berjalan", () => {
    for (const status of ["DRIVER_ASSIGNED", "DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_TRIP"] as const) {
      expect(chatCanSend(status, null, now), status).toBe(true);
    }
  });
  it("selesai: boleh balas 2 jam, lalu tutup; tanpa waktu selesai = tutup", () => {
    expect(chatCanSend("COMPLETED", new Date(now.getTime() - 1 * HOUR), now)).toBe(true);
    expect(chatCanSend("COMPLETED", new Date(now.getTime() - 3 * HOUR), now)).toBe(false);
    expect(chatCanSend("COMPLETED", null, now)).toBe(false);
  });
  it("status lain tidak boleh", () => {
    for (const status of ["CREATED", "SEARCHING_DRIVER", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_DRIVER"] as const) {
      expect(chatCanSend(status, null, now), status).toBe(false);
    }
  });
});

describe.skipIf(!runIntegration)("Chat: notifikasi dan kotak masuk", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "chat-inbox-access-secret-0000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "chat-inbox-refresh-secret-000000000";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("pesan penumpang -> notifikasi ke driver; pesan driver -> ke penumpang; tanpa isi pesan", async () => {
    const { passenger, driverUser, rideOrder } = await seedRideOrder("IN_TRIP");
    const push = new RecordingPush();
    const chat = new ChatService(prisma as never, push);

    await chat.sendMessage({ rideRef: rideOrder.publicReference, userId: passenger.id, message: "Saya di depan warung, baju biru" });
    await chat.sendMessage({ rideRef: rideOrder.publicReference, userId: driverUser.id, message: "Siap, 2 menit lagi" });
    await flush();

    expect(push.sent.map((e) => [e.userId, e.message.title])).toEqual([
      [driverUser.id, "Pesan baru dari penumpang"],
      [passenger.id, "Pesan baru dari driver"]
    ]);
    const text = JSON.stringify(push.sent);
    expect(text).not.toContain("warung");
    expect(text).not.toContain("2 menit");
    expect(push.sent[0]!.message.data).toEqual({ type: "chat_message", rideReference: rideOrder.publicReference });
  });

  it("rentetan pesan dibatasi satu notifikasi per 20 detik per percakapan", async () => {
    const { passenger, driverUser, rideOrder } = await seedRideOrder("IN_TRIP");
    const push = new RecordingPush();
    const chat = new ChatService(prisma as never, push);
    for (const text of ["a", "b", "c", "d"]) {
      await chat.sendMessage({ rideRef: rideOrder.publicReference, userId: driverUser.id, message: text });
    }
    await flush();
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.userId).toBe(passenger.id);
  });

  it("pengiriman ditolak (chat belum aktif) tidak menghasilkan notifikasi", async () => {
    const { passenger, rideOrder } = await seedRideOrder("SEARCHING_DRIVER");
    const push = new RecordingPush();
    const chat = new ChatService(prisma as never, push);
    await expect(chat.sendMessage({ rideRef: rideOrder.publicReference, userId: passenger.id, message: "halo" })).rejects.toBeDefined();
    await flush();
    expect(push.sent).toHaveLength(0);
  });

  it("push gagal tidak menggagalkan pengiriman pesan", async () => {
    const { driverUser, rideOrder } = await seedRideOrder("IN_TRIP");
    const push = new RecordingPush();
    push.failWith = new Error("fcm down");
    const chat = new ChatService(prisma as never, push);
    const saved = await chat.sendMessage({ rideRef: rideOrder.publicReference, userId: driverUser.id, message: "halo" });
    await flush();
    expect(saved.message).toBe("halo");
  });

  it("selesai > 2 jam: tidak bisa membalas lagi, tetapi tetap terbaca di kotak masuk (canSend=false)", async () => {
    const { passenger, rideOrder } = await seedRideOrder("COMPLETED", "1", new Date(Date.now() - 3 * HOUR));
    const chat = new ChatService(prisma as never, new RecordingPush());
    await expect(chat.sendMessage({ rideRef: rideOrder.publicReference, userId: passenger.id, message: "terlambat" })).rejects.toMatchObject({ code: "CHAT_RIDE_NOT_ACTIVE" });
    const inbox = await chat.listConversations(passenger.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.canSend).toBe(false);
  });

  it("kotak masuk: hanya milik sendiri, pesan terakhir, hitungan belum dibaca, dan markRead", async () => {
    const mine = await seedRideOrder("IN_TRIP", "A");
    const other = await seedRideOrder("IN_TRIP", "B");
    const chat = new ChatService(prisma as never, new RecordingPush());

    await chat.sendMessage({ rideRef: mine.rideOrder.publicReference, userId: mine.driverUser.id, message: "satu" });
    await chat.sendMessage({ rideRef: mine.rideOrder.publicReference, userId: mine.driverUser.id, message: "dua" });
    await chat.sendMessage({ rideRef: mine.rideOrder.publicReference, userId: mine.passenger.id, message: "balasan saya" });
    await chat.sendMessage({ rideRef: other.rideOrder.publicReference, userId: other.driverUser.id, message: "rahasia orang lain" });

    const inbox = await chat.listConversations(mine.passenger.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      rideReference: mine.rideOrder.publicReference,
      counterpart: "DRIVER",
      canSend: true,
      unreadCount: 2,
      lastMessage: { text: "balasan saya", senderType: "USER" }
    });
    expect(JSON.stringify(inbox)).not.toContain("rahasia");

    await chat.markRead({ rideRef: mine.rideOrder.publicReference, userId: mine.passenger.id });
    expect((await chat.listConversations(mine.passenger.id))[0]!.unreadCount).toBe(0);

    // Sisi driver: lawan bicaranya penumpang, dan pesan penumpang belum dibaca driver.
    const driverInbox = await chat.listConversations(mine.driverUser.id);
    expect(driverInbox[0]).toMatchObject({ counterpart: "PASSENGER", unreadCount: 1 });
  });

  it("selesai dalam 7 hari tampil; lebih dari 7 hari dan perjalanan batal tidak tampil", async () => {
    const recent = await seedRideOrder("COMPLETED", "C", new Date(Date.now() - 3 * 24 * HOUR));
    const chat = new ChatService(prisma as never, new RecordingPush());
    expect((await chat.listConversations(recent.passenger.id)).map((c) => c.rideReference)).toEqual([recent.rideOrder.publicReference]);
    await cleanDatabase();
    await seedMemberships();
    const old = await seedRideOrder("COMPLETED", "D", new Date(Date.now() - 8 * 24 * HOUR));
    expect(await chat.listConversations(old.passenger.id)).toHaveLength(0);
    await cleanDatabase();
    await seedMemberships();
    const cancelled = await seedRideOrder("CANCELLED_BY_DRIVER", "E");
    expect(await chat.listConversations(cancelled.passenger.id)).toHaveLength(0);
  });

  it("GET /chat/conversations: butuh login dan hanya mengembalikan milik pemanggil", async () => {
    const mine = await seedRideOrder("IN_TRIP", "F");
    const stranger = await createUser("CHATSTRANGER", "USER");
    expect((await api("/api/v1/chat/conversations")).status).toBe(401);
    const own = await api("/api/v1/chat/conversations", { token: tokenFor(mine.passenger) });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { data: unknown[] }).data).toHaveLength(1);
    const none = await api("/api/v1/chat/conversations", { token: tokenFor(stranger) });
    expect(((await none.json()) as { data: unknown[] }).data).toHaveLength(0);
  });
});

async function seedRideOrder(status: RideOrderStatus, suffix = "1", completedAt?: Date) {
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
      paymentState: "CASH_EXPECTED",
      ...(status === "COMPLETED" ? { completedAt: completedAt ?? new Date() } : {})
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
