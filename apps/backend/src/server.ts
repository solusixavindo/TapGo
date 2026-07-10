import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { logger } from "./core/logger/logger.js";

const app = createApp();
const httpServer = http.createServer(app);

export const io = new Server(httpServer, {
  cors: {
    origin: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
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

const server = httpServer.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, "TapGo backend is running");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down server");
  server.close(async () => {
    await redis?.quit();
    await disconnectPrisma();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
