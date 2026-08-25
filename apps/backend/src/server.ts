import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma, prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { logger } from "./core/logger/logger.js";
import { disconnectRateLimitStore } from "./core/security/rateLimitStore.js";
import { DriverDocumentService } from "./modules/drivers/application/DriverDocumentService.js";
import { MembershipDocumentService } from "./modules/memberships/application/MembershipDocumentService.js";
import { PpobService } from "./modules/ppob/application/PpobService.js";
import { PrismaPpobRepository } from "./modules/ppob/infrastructure/PrismaPpobRepository.js";
import { DigiflazzPpobProvider } from "./modules/ppob/infrastructure/DigiflazzPpobProvider.js";
import { attachRealtime } from "./realtime/socket.js";
import { setOtpDeliveryProvider } from "./modules/auth/infrastructure/otpProviderRegistry.js";
import { SmtpOtpProvider } from "./modules/auth/infrastructure/SmtpOtpProvider.js";

const app = createApp();
const httpServer = http.createServer(app);

/**
 * Pemasangan provider OTP dari environment (keputusan Owner G3).
 *
 * Dipasang di server.ts, bukan createApp(): test mengimpor createApp puluhan
 * kali dan harus tetap pada default fail-closed kecuali menyetel providernya
 * sendiri secara eksplisit. Tanpa SMTP_HOST, default UnavailableOtpProvider
 * tetap berlaku; konfigurasi parsial menggagalkan boot di sini.
 */
if (env.SMTP_HOST) {
  const missing: string[] = [];
  if (!env.SMTP_FROM) missing.push("SMTP_FROM");
  if (!env.SMTP_USER) missing.push("SMTP_USER");
  if (!env.SMTP_PASS) missing.push("SMTP_PASS");
  if (missing.length > 0) {
    throw new Error(
      `SMTP_HOST di-set tetapi ${missing.join(", ")} kosong. ` +
        "Lengkapi konfigurasi SMTP atau hapus SMTP_HOST."
    );
  }
  const smtpOtpProvider = SmtpOtpProvider.fromConfig({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER!,
    pass: env.SMTP_PASS!,
    from: env.SMTP_FROM!
  });
  setOtpDeliveryProvider(smtpOtpProvider);
  logger.info({ provider: smtpOtpProvider.name }, "OTP email provider aktif");
}

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
const membershipDocuments = new MembershipDocumentService(prisma);
const driverDocuments = new DriverDocumentService(prisma);
const PURGE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Dokumen mitra driver disapu bersama dokumen membership.
 *
 * Kebijakan 24 jam berlaku sama untuk keduanya, jadi keduanya WAJIB punya
 * pembersih. Sebelumnya hanya membership yang tersapu, dan baris dokumen driver
 * menumpuk tanpa batas — isinya memang tidak pernah tersaji karena masa simpan
 * ditegakkan saat pembacaan, tetapi menyimpan sisa yang tidak pernah dipakai
 * bukan yang dijanjikan kepada mitra.
 *
 * Keduanya disapu terpisah supaya kegagalan salah satunya tidak menghentikan
 * yang lain.
 */
const SWEEPERS = [
  { nama: "membership", sapu: () => membershipDocuments.purgeExpired() },
  { nama: "driver", sapu: () => driverDocuments.purgeExpired() }
] as const;

async function purgeExpiredDocuments() {
  for (const sweeper of SWEEPERS) {
    try {
      const purged = await sweeper.sapu();
      if (purged > 0) {
        // Hanya jumlahnya. Tidak pernah id pemilik, apalagi isi dokumen.
        logger.info({ purged, scope: sweeper.nama }, "Expired documents purged");
      }
    } catch (error) {
      logger.error(
        { err: error, scope: sweeper.nama },
        "Failed to purge expired documents"
      );
    }
  }
}

const purgeTimer = setInterval(() => void purgeExpiredDocuments(), PURGE_INTERVAL_MS);
purgeTimer.unref();
void purgeExpiredDocuments();

/**
 * Worker rekonsiliasi PPOB (Stage R2.8).
 *
 * Fail-closed: hanya berjalan bila PPOB_RECONCILE_ENABLED=true DAN provider
 * mendukung cek status (digiflazz). Advisory lock Postgres memastikan hanya
 * satu instance yang menjalankan siklus pada satu waktu, dan finalisasi tetap
 * idempoten bila webhook dan worker menyentuh transaksi yang sama.
 *
 * Dipasang di server.ts (bukan createApp) dengan alasan yang sama seperti
 * penyapu dokumen: test mengimpor createApp puluhan kali dan tidak boleh ikut
 * menyalakan timer latar.
 */
let ppobReconcileTimer: NodeJS.Timeout | undefined;
if (env.PPOB_RECONCILE_ENABLED && env.PPOB_PROVIDER === "digiflazz") {
  const ppobService = new PpobService(
    new PrismaPpobRepository(prisma),
    DigiflazzPpobProvider.fromEnv()
  );
  const runReconcileCycle = async () => {
    try {
      const result = await ppobService.reconcileOpenTransactions();
      if (!result.skipped && (result.escalated > 0 || result.finalized > 0 || result.errors > 0)) {
        // Hanya jumlah — tidak pernah referensi maupun nomor tujuan.
        logger.info(result, "PPOB reconciliation cycle completed");
      }
    } catch (error) {
      logger.error({ err: error }, "PPOB reconciliation cycle failed");
    }
  };
  ppobReconcileTimer = setInterval(() => void runReconcileCycle(), env.PPOB_RECONCILE_INTERVAL_MS);
  ppobReconcileTimer.unref();
  void runReconcileCycle();
}

const server = httpServer.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, "TapGo backend is running");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down server");
  clearInterval(purgeTimer);
  if (ppobReconcileTimer) {
    clearInterval(ppobReconcileTimer);
  }
  server.close(async () => {
    await redis?.quit();
    await disconnectRateLimitStore();
    await disconnectPrisma();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
