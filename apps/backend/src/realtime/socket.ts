import { Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import { corsOrigins, env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../core/logger/logger.js";
import { resolveAuthFromToken } from "../core/security/authContext.js";
import { ChatService } from "../modules/chat/application/ChatService.js";

let currentIo: Server | null = null;
const chatService = new ChatService(prisma);

type AuthedSocket = Socket & { data: { userId: string } };

/**
 * Attach Socket.IO ke HTTP server HANYA bila REALTIME_ENABLED=true.
 *
 * Fail-closed untuk Release 1 (Basic Portal, tanpa realtime/chat): saat
 * dinonaktifkan, tidak ada listener yang di-attach sehingga tidak ada endpoint
 * realtime aktif dan permukaan `ws`/Socket.IO tidak terekspos. REST API dan
 * health endpoint tetap berjalan karena keduanya milik Express, bukan Socket.IO.
 */
export function attachRealtime(httpServer: HttpServer): Server | null {
  if (!env.REALTIME_ENABLED) {
    logger.info({ realtime: false }, "Realtime disabled — Socket.IO not attached");
    return null;
  }

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true
    }
  });

  // Autentikasi koneksi (Stage R2.10).
  //
  // Sebelumnya socket.io TIDAK memeriksa identitas sama sekali: siapa pun
  // yang tersambung dapat memanggil `ride:join` dengan rideId sembarang dan
  // ikut menerima event ride tersebut. Middleware ini menuntut token access
  // yang sama dengan REST API (Authorization Bearer via query/auth handshake)
  // dan tunduk pada pencabutan sesi berbasis authVersion yang sama —
  // resolveAuthFromToken adalah fungsi yang sama persis dipakai requireAuth.
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth as { token?: unknown } | undefined)?.token ??
      socket.handshake.query.token;
    if (typeof token !== "string" || !token) {
      next(new Error("AUTH_TOKEN_MISSING"));
      return;
    }
    resolveAuthFromToken(token)
      .then((auth) => {
        (socket as AuthedSocket).data.userId = auth.userId;
        next();
      })
      .catch(() => next(new Error("AUTH_TOKEN_INVALID")));
  });

  io.on("connection", (socket: AuthedSocket) => {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, "Socket connected");

    // Audit keamanan 30 September 2026 (L2): sebelumnya HANYA disiarkan ke
    // room ride yang benar (bukan ke seluruh socket yang tersambung), tapi
    // TIDAK memverifikasi bahwa pemanggil benar-benar driver ride tersebut —
    // penumpang (atau siapa pun yang tahu rideId) bisa menyiarkan "lokasi
    // driver" palsu ke room itu. Sekarang memakai resolveParticipant yang
    // sama dengan ride:join di bawah: hanya DRIVER ride ini yang boleh
    // menyiarkan, room dituju lewat rideOrderId hasil resolusi (bukan string
    // mentah dari klien), dan payload yang diteruskan disaring ke field geo
    // yang dikenal saja — tidak pernah meneruskan field lain apa pun dari
    // klien (mis. token) ke penumpang yang mendengarkan room ini.
    socket.on(
      "driver:location",
      (payload: { rideId?: unknown; lat?: unknown; lng?: unknown; heading?: unknown; speed?: unknown }) => {
        const rideId = typeof payload?.rideId === "string" ? payload.rideId : null;
        const lat = typeof payload?.lat === "number" ? payload.lat : null;
        const lng = typeof payload?.lng === "number" ? payload.lng : null;
        if (!rideId || lat === null || lng === null) return;
        chatService
          .resolveParticipant(rideId, socket.data.userId)
          .then((participant) => {
            if (participant.senderType !== "DRIVER") return;
            socket.to(`ride:${participant.rideOrderId}`).emit("driver:location:update", {
              rideId: participant.rideOrderId,
              lat,
              lng,
              heading: typeof payload.heading === "number" ? payload.heading : null,
              speed: typeof payload.speed === "number" ? payload.speed : null
            });
          })
          .catch(() => {
            // Ride tidak ditemukan/pemanggil bukan partisipannya — diam-diam
            // diabaikan, sama seperti alasan 404 di resolveParticipant
            // (tidak perlu konfirmasi keberadaan ride ke non-partisipan).
          });
      }
    );

    // Bergabung ke room ride HANYA bila pemanggil benar-benar penumpang atau
    // driver ride tersebut — sebelumnya rideId apa pun diterima tanpa
    // verifikasi kepemilikan.
    socket.on("ride:join", (rideId: unknown, ack?: (result: { ok: boolean; error?: string }) => void) => {
      if (typeof rideId !== "string" || !rideId) {
        ack?.({ ok: false, error: "RIDE_ID_REQUIRED" });
        return;
      }
      chatService
        .resolveParticipant(rideId, socket.data.userId)
        .then((participant) => {
          socket.join(`ride:${participant.rideOrderId}`);
          ack?.({ ok: true });
        })
        .catch(() => {
          ack?.({ ok: false, error: "RIDE_NOT_JOINABLE" });
        });
    });

    socket.on(
      "chat:send",
      (input: { rideId?: unknown; message?: unknown }, ack?: (result: { ok: boolean; error?: string }) => void) => {
        const rideId = typeof input?.rideId === "string" ? input.rideId : null;
        const message = typeof input?.message === "string" ? input.message : null;
        if (!rideId || !message) {
          ack?.({ ok: false, error: "CHAT_PAYLOAD_INVALID" });
          return;
        }
        chatService
          .sendMessage({ rideRef: rideId, userId: socket.data.userId, message })
          .then((saved) => {
            io.to(`ride:${saved.rideOrderId}`).emit("chat:message", saved);
            ack?.({ ok: true });
          })
          .catch((error: unknown) => {
            ack?.({ ok: false, error: error instanceof Error ? error.message : "CHAT_SEND_FAILED" });
          });
      }
    );
  });

  currentIo = io;
  logger.info({ realtime: true }, "Realtime enabled — Socket.IO attached");
  return io;
}

/**
 * Dipanggil dari jalur REST (chat.controller.ts) supaya pesan yang dikirim
 * lewat fallback HTTP tetap sampai real-time ke lawan bicara yang sedang
 * terhubung socket. No-op yang aman bila realtime tidak aktif.
 */
export function emitChatMessage(rideOrderId: string, message: unknown) {
  currentIo?.to(`ride:${rideOrderId}`).emit("chat:message", message);
}
