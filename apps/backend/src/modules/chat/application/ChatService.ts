import { ChatSenderType, Prisma, PrismaClient, RideOrderStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { lazyPushNotifier } from "../../notifications/application/pushServiceFactory.js";
import type { PushNotifier } from "../../notifications/application/rideNotifications.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Setelah perjalanan selesai: masih boleh MEMBALAS 2 jam (barang tertinggal,
 * konfirmasi singkat), lalu percakapan hanya bisa DIBACA sampai 7 hari, dan
 * sesudah itu hilang dari kotak masuk (Owner, 2026-09-25).
 */
const COMPLETED_REPLY_WINDOW_MS = 2 * 60 * 60 * 1000;
const COMPLETED_VISIBLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Batas satu notifikasi pesan baru per percakapan per penerima (anti-spam). */
const PUSH_MIN_INTERVAL_MS = 20_000;

const ACTIVE_ONLY_STATUSES: RideOrderStatus[] = ["DRIVER_ASSIGNED", "DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_TRIP"];

/** Boleh mengirim pesan sekarang? Aktif selama perjalanan; 2 jam setelah selesai. */
export function chatCanSend(status: RideOrderStatus, completedAt: Date | null, now: Date): boolean {
  if (ACTIVE_ONLY_STATUSES.includes(status)) return true;
  if (status === "COMPLETED") {
    return completedAt !== null && now.getTime() - completedAt.getTime() <= COMPLETED_REPLY_WINDOW_MS;
  }
  return false;
}

export type ChatParticipant = { rideOrderId: string; senderType: ChatSenderType };

export class ChatService {
  private readonly lastPushAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly push: PushNotifier = lazyPushNotifier
  ) {}

  /**
   * Satu-satunya jalan resolusi partisipan — dipakai baik oleh REST route
   * maupun handler Socket.IO (Stage R2.10), supaya keduanya tunduk pada
   * pemeriksaan yang sama persis. rideRef boleh UUID internal atau
   * publicReference (RID-...), sama seperti rute ride lain.
   */
  async resolveParticipant(
    rideRef: string,
    userId: string
  ): Promise<
    ChatParticipant & {
      status: RideOrderStatus;
      completedAt: Date | null;
      publicReference: string;
      counterpartUserId: string | null;
    }
  > {
    // `id` adalah kolom UUID — Prisma melempar galat tingkat driver (bukan
    // "not found" yang rapi) bila mencoba mem-parameterkan string berformat
    // publicReference ("RID-...") ke kolom itu, jadi cabang id hanya
    // disertakan bila rideRef benar-benar berbentuk UUID.
    const order = await this.prisma.rideOrder.findFirst({
      where: UUID_PATTERN.test(rideRef) ? { OR: [{ id: rideRef }, { publicReference: rideRef }] } : { publicReference: rideRef },
      select: {
        id: true,
        status: true,
        completedAt: true,
        publicReference: true,
        passengerId: true,
        driverProfile: { select: { userId: true } }
      }
    });

    if (!order) {
      throw new AppError("Ride not found", StatusCodes.NOT_FOUND, "CHAT_RIDE_NOT_FOUND");
    }

    if (order.passengerId === userId) {
      return {
        rideOrderId: order.id,
        senderType: "USER",
        status: order.status,
        completedAt: order.completedAt,
        publicReference: order.publicReference,
        counterpartUserId: order.driverProfile?.userId ?? null
      };
    }
    if (order.driverProfile?.userId === userId) {
      return {
        rideOrderId: order.id,
        senderType: "DRIVER",
        status: order.status,
        completedAt: order.completedAt,
        publicReference: order.publicReference,
        counterpartUserId: order.passengerId
      };
    }

    // 404, bukan 403: keberadaan ride bagi non-partisipan tidak perlu
    // dikonfirmasi, pola yang sama dengan RideService.getOrderForPassenger.
    throw new AppError("Ride not found", StatusCodes.NOT_FOUND, "CHAT_RIDE_NOT_FOUND");
  }

  async sendMessage(input: { rideRef: string; userId: string; message: string }) {
    const participant = await this.resolveParticipant(input.rideRef, input.userId);
    if (!chatCanSend(participant.status, participant.completedAt, new Date())) {
      throw new AppError("Chat is not available for this ride yet", StatusCodes.CONFLICT, "CHAT_RIDE_NOT_ACTIVE");
    }

    const trimmed = input.message.trim();
    if (!trimmed) {
      throw new AppError("Message cannot be empty", StatusCodes.BAD_REQUEST, "CHAT_MESSAGE_EMPTY");
    }
    if (trimmed.length > 1000) {
      throw new AppError("Message is too long", StatusCodes.BAD_REQUEST, "CHAT_MESSAGE_TOO_LONG");
    }

    const saved = await this.prisma.chatMessage.create({
      data: {
        rideOrderId: participant.rideOrderId,
        senderId: input.userId,
        senderType: participant.senderType,
        message: trimmed
      }
    });
    this.notifyCounterpart(participant, saved.rideOrderId);
    return saved;
  }

  /**
   * Notifikasi "pesan baru" ke lawan bicara, setelah pesan tersimpan. Tanpa isi
   * pesan (tampil di layar kunci) dan dibatasi satu per 20 detik per
   * percakapan agar rentetan pesan tidak membanjiri. Tidak pernah melempar dan
   * tidak menahan pengiriman pesan.
   */
  private notifyCounterpart(
    participant: { senderType: ChatSenderType; counterpartUserId: string | null; publicReference: string },
    rideOrderId: string
  ) {
    const recipient = participant.counterpartUserId;
    if (!recipient || !this.push.enabled) return;
    const key = `${rideOrderId}:${recipient}`;
    const now = Date.now();
    const last = this.lastPushAt.get(key) ?? 0;
    if (now - last < PUSH_MIN_INTERVAL_MS) return;
    this.lastPushAt.set(key, now);
    if (this.lastPushAt.size > 5000) {
      for (const [k, at] of this.lastPushAt) if (now - at > PUSH_MIN_INTERVAL_MS) this.lastPushAt.delete(k);
    }
    const fromDriver = participant.senderType === "DRIVER";
    void this.push
      .notifyUser(recipient, {
        title: fromDriver ? "Pesan baru dari driver" : "Pesan baru dari penumpang",
        body: "Ketuk untuk membaca dan membalas.",
        data: { type: "chat_message", rideReference: participant.publicReference }
      })
      .catch(() => undefined);
  }

  /**
   * Kotak masuk chat: perjalanan milik pemanggil (sebagai penumpang atau driver)
   * yang percakapannya masih relevan — aktif, atau selesai dalam 7 hari — beserta
   * pesan terakhir dan jumlah pesan lawan bicara yang belum dibaca.
   */
  async listConversations(userId: string, limit = 20) {
    const now = new Date();
    const since = new Date(now.getTime() - COMPLETED_VISIBLE_WINDOW_MS);
    const rides = await this.prisma.rideOrder.findMany({
      where: {
        OR: [{ passengerId: userId }, { driverProfile: { userId } }],
        AND: [
          {
            OR: [
              { status: { in: ACTIVE_ONLY_STATUSES } },
              { status: "COMPLETED", completedAt: { gte: since } }
            ]
          }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 50),
      select: {
        id: true,
        publicReference: true,
        status: true,
        serviceType: true,
        completedAt: true,
        passengerId: true
      }
    });
    if (rides.length === 0) return [];
    const ids = rides.map((ride) => ride.id);

    const [lastMessages, unread] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { rideOrderId: { in: ids } },
        orderBy: { createdAt: "desc" },
        distinct: ["rideOrderId"],
        select: { rideOrderId: true, message: true, senderType: true, createdAt: true }
      }),
      this.prisma.chatMessage.groupBy({
        by: ["rideOrderId"],
        where: { rideOrderId: { in: ids }, senderId: { not: userId }, readAt: null },
        _count: { _all: true }
      })
    ]);
    const lastBy = new Map(lastMessages.map((m) => [m.rideOrderId, m]));
    const unreadBy = new Map(unread.map((u) => [u.rideOrderId, u._count._all]));

    return rides
      .map((ride) => {
        const last = lastBy.get(ride.id) ?? null;
        return {
          rideReference: ride.publicReference,
          status: ride.status,
          serviceType: ride.serviceType,
          counterpart: ride.passengerId === userId ? ("DRIVER" as const) : ("PASSENGER" as const),
          canSend: chatCanSend(ride.status, ride.completedAt, now),
          unreadCount: unreadBy.get(ride.id) ?? 0,
          lastMessage: last
            ? { text: last.message, senderType: last.senderType, createdAt: last.createdAt }
            : null
        };
      })
      .sort((a, b) => {
        const at = a.lastMessage?.createdAt.getTime() ?? 0;
        const bt = b.lastMessage?.createdAt.getTime() ?? 0;
        return bt - at;
      });
  }

  async listMessages(input: { rideRef: string; userId: string; page: number; pageSize: number }) {
    const participant = await this.resolveParticipant(input.rideRef, input.userId);
    const pageSize = Math.min(input.pageSize, 100);
    return this.prisma.chatMessage.findMany({
      where: { rideOrderId: participant.rideOrderId },
      orderBy: { createdAt: "asc" },
      skip: (input.page - 1) * pageSize,
      take: pageSize
    });
  }

  /** Menandai seluruh pesan LAWAN BICARA (bukan pesan sendiri) sebagai terbaca. */
  async markRead(input: { rideRef: string; userId: string }) {
    const participant = await this.resolveParticipant(input.rideRef, input.userId);
    const result = await this.prisma.chatMessage.updateMany({
      where: {
        rideOrderId: participant.rideOrderId,
        senderId: { not: input.userId },
        readAt: null
      },
      data: { readAt: new Date() }
    });
    return { updated: result.count };
  }
}

export type ChatMessageRecord = Prisma.ChatMessageGetPayload<Record<string, never>>;
