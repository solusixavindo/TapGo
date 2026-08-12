import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma, prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { logger } from "./core/logger/logger.js";
import { MembershipDocumentService } from "./modules/memberships/application/MembershipDocumentService.js";
import { attachRealtime } from "./realtime/socket.js";

const app = createApp();
const httpServer = http.createServer(app);

// Fail-closed: null saat REALTIME_ENABLED=false (Release 1 tanpa realtime).
export const io = attachRealtime(httpServer);

/**
 * Penyapu dokumen identitas yang sudah lewat masa simpan.
 *
 * Sengaja dipasang di server.ts, bukan di createApp(): test mengimpor createApp
 * puluhan kali dan tidak boleh ikut menyalakan timer latar.
 *
 * Penyapu ini adalah pembersih, BUKAN penjaga. Penegakan masa simpan yang
 * sebenarnya ada pada pembacaan — isi dokumen yang sudah kedaluwarsa tidak
 * pernah disajikan walau penyapunya sedang tertunda atau mati.
 */
const documentService = new MembershipDocumentService(prisma);
const PURGE_INTERVAL_MS = 15 * 60 * 1000;

async function purgeExpiredDocuments() {
  try {
    const purged = await documentService.purgeExpired();
    if (purged > 0) {
      // Hanya jumlahnya. Tidak pernah id pemohon, apalagi isi dokumen.
      logger.info({ purged }, "Expired membership documents purged");
    }
  } catch (error) {
    logger.error({ err: error }, "Failed to purge expired membership documents");
  }
}

const purgeTimer = setInterval(() => void purgeExpiredDocuments(), PURGE_INTERVAL_MS);
purgeTimer.unref();
void purgeExpiredDocuments();

const server = httpServer.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, "TapGo backend is running");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down server");
  clearInterval(purgeTimer);
  server.close(async () => {
    await redis?.quit();
    await disconnectPrisma();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
