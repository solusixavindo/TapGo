import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { logger } from "./core/logger/logger.js";
import { attachRealtime } from "./realtime/socket.js";

const app = createApp();
const httpServer = http.createServer(app);

// Fail-closed: null saat REALTIME_ENABLED=false (Release 1 tanpa realtime).
export const io = attachRealtime(httpServer);

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
