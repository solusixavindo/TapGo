import { ChatSenderType, Prisma, PrismaClient, RideOrderStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Jendela status ride yang membolehkan chat.
 *
 * Mulai dari DRIVER_ASSIGNED (baru ada lawan bicara) sampai IN_TRIP, dan tetap
 * dibuka pada COMPLETED (grace period) supaya percakapan terkait perjalanan
 * yang baru selesai — mis. barang tertinggal — masih bisa dibaca/dibalas
 * sebentar. Status sebelum penugasan driver (belum ada lawan bicara) dan
 * status batal/kedaluwarsa sengaja tidak termasuk.
 */
const CHAT_ACTIVE_STATUSES = new Set<RideOrderStatus>([
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP",
  "COMPLETED"
]);

export type ChatParticipant = { rideOrderId: string; senderType: ChatSenderType };

export class ChatService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Satu-satunya jalan resolusi partisipan — dipakai baik oleh REST route
   * maupun handler Socket.IO (Stage R2.10), supaya keduanya tunduk pada
   * pemeriksaan yang sama persis. rideRef boleh UUID internal atau
   * publicReference (RID-...), sama seperti rute ride lain.
   */
  async resolveParticipant(rideRef: string, userId: string): Promise<ChatParticipant & { status: RideOrderStatus }> {
    // `id` adalah kolom UUID — Prisma melempar galat tingkat driver (bukan
    // "not found" yang rapi) bila mencoba mem-parameterkan string berformat
    // publicReference ("RID-...") ke kolom itu, jadi cabang id hanya
    // disertakan bila rideRef benar-benar berbentuk UUID.
    const order = await this.prisma.rideOrder.findFirst({
      where: UUID_PATTERN.test(rideRef) ? { OR: [{ id: rideRef }, { publicReference: rideRef }] } : { publicReference: rideRef },
      select: {
        id: true,
        status: true,
        passengerId: true,
        driverProfile: { select: { userId: true } }
      }
    });

    if (!order) {
      throw new AppError("Ride not found", StatusCodes.NOT_FOUND, "CHAT_RIDE_NOT_FOUND");
    }

    if (order.passengerId === userId) {
      return { rideOrderId: order.id, senderType: "USER", status: order.status };
    }
    if (order.driverProfile?.userId === userId) {
      return { rideOrderId: order.id, senderType: "DRIVER", status: order.status };
    }

    // 404, bukan 403: keberadaan ride bagi non-partisipan tidak perlu
    // dikonfirmasi, pola yang sama dengan RideService.getOrderForPassenger.
    throw new AppError("Ride not found", StatusCodes.NOT_FOUND, "CHAT_RIDE_NOT_FOUND");
  }

  async sendMessage(input: { rideRef: string; userId: string; message: string }) {
    const participant = await this.resolveParticipant(input.rideRef, input.userId);
    if (!CHAT_ACTIVE_STATUSES.has(participant.status)) {
      throw new AppError("Chat is not available for this ride yet", StatusCodes.CONFLICT, "CHAT_RIDE_NOT_ACTIVE");
    }

    const trimmed = input.message.trim();
    if (!trimmed) {
      throw new AppError("Message cannot be empty", StatusCodes.BAD_REQUEST, "CHAT_MESSAGE_EMPTY");
    }
    if (trimmed.length > 1000) {
      throw new AppError("Message is too long", StatusCodes.BAD_REQUEST, "CHAT_MESSAGE_TOO_LONG");
    }

    return this.prisma.chatMessage.create({
      data: {
        rideOrderId: participant.rideOrderId,
        senderId: input.userId,
        senderType: participant.senderType,
        message: trimmed
      }
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
