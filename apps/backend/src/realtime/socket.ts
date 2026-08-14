import { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { corsOrigins, env } from "../config/env.js";
import { logger } from "../core/logger/logger.js";

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

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");

    socket.on("driver:location", (payload) => {
      socket.broadcast.emit("driver:location:update", payload);
    });

    socket.on("ride:join", (rideId: string) => {
      socket.join(`ride:${rideId}`);
    });
  });

  logger.info({ realtime: true }, "Realtime enabled — Socket.IO attached");
  return io;
}
