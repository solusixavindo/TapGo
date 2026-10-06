import http from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma, prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { logger } from "./core/logger/logger.js";
import { initSentry } from "./core/monitoring/sentry.js";
import { disconnectRateLimitStore } from "./core/security/rateLimitStore.js";
import { DriverDocumentService } from "./modules/drivers/application/DriverDocumentService.js";
import { expireStaleRideSearches } from "./modules/rides/application/rideSearchExpiry.js";
import { MembershipDocumentService } from "./modules/memberships/application/MembershipDocumentService.js";
import { PpobService } from "./modules/ppob/application/PpobService.js";
import { PpobPriceSyncService } from "./modules/ppob/application/PpobPriceSyncService.js";
import { PrismaPpobRepository } from "./modules/ppob/infrastructure/PrismaPpobRepository.js";
import { DigiflazzPpobProvider } from "./modules/ppob/infrastructure/DigiflazzPpobProvider.js";
import { attachRealtime } from "./realtime/socket.js";
import { setOtpDeliveryProvider } from "./modules/auth/infrastructure/otpProviderRegistry.js";
import { SmtpOtpProvider } from "./modules/auth/infrastructure/SmtpOtpProvider.js";

// Baris pertama yang dieksekusi (impor ESM sudah di-hoist di atasnya, tapi
// tidak ada modul lain di file ini yang menjalankan kode saat diimpor selain
// pembacaan env di env.ts) — no-op bila SENTRY_DSN kosong (lihat
// core/monitoring/sentry.ts).
initSentry();

// logger.error/.fatal di sini otomatis diteruskan ke Sentry lewat hook di
// core/logger/logger.ts — tidak perlu Sentry.captureException manual.
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception — proses akan berhenti");
  process.exit(1);
});
// Audit keamanan 30 September 2026 (M6): sebelumnya rejection tak tertangani
// hanya di-log, proses tetap hidup dalam keadaan yang mungkin sudah rusak
// (mis. state paruh-selesai yang tidak lagi konsisten) — sama seriusnya
// dengan uncaughtException, jadi diperlakukan identik: log fatal lalu keluar.
// Prasyaratnya: SETIAP promise yang sengaja tidak di-await di seluruh berkas
// ini dan di socket.ts sudah dibungkus try/catch atau diberi .catch sendiri
// (lihat sweepStaleRideSearches, purgeExpiredDocuments, runReconcileCycle,
// runPriceSyncCycle, shutdown, dan socket.ts) — supaya exit ini menangkap
// kegagalan yang SUNGGUH belum diketahui, bukan kelalaian yang sudah dikenal.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection — proses akan berhenti");
  process.exit(1);
});

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

const RIDE_SEARCH_SWEEP_INTERVAL_MS = 30 * 1000;

/** Pesanan tanpa driver melewati batas waktu pencarian menjadi NO_DRIVER (Stage D2). */
async function sweepStaleRideSearches() {
  try {
    const expired = await expireStaleRideSearches(prisma);
    if (expired > 0) {
      logger.info({ expired }, "Ride searches expired (NO_DRIVER)");
    }
  } catch (error) {
    logger.error({ err: error }, "Failed to expire stale ride searches");
  }
}

const rideSearchTimer = setInterval(() => void sweepStaleRideSearches(), RIDE_SEARCH_SWEEP_INTERVAL_MS);
rideSearchTimer.unref();

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

/**
 * Worker sinkronisasi harga PPOB (Stage R2.12).
 *
 * Sama alasannya dengan worker rekonsiliasi di atas: dipasang di server.ts
 * (bukan createApp) supaya test yang mengimpor createApp tidak ikut
 * menyalakan timer latar, dan hanya berjalan bila diaktifkan eksplisit
 * dengan provider yang mendukungnya.
 */
let ppobPriceSyncTimer: NodeJS.Timeout | undefined;
if (env.PPOB_PRICE_SYNC_ENABLED && env.PPOB_PROVIDER === "digiflazz") {
  const priceSyncService = new PpobPriceSyncService(
    new PrismaPpobRepository(prisma),
    DigiflazzPpobProvider.fromEnv()
  );
  const runPriceSyncCycle = async () => {
    try {
      const result = await priceSyncService.runSyncCycle();
      if (!result.skipped) {
        logger.info(result, "PPOB price sync cycle completed");
      }

    } catch (error) {
      logger.error({ err: error }, "PPOB price sync cycle failed");
    }
  };
  ppobPriceSyncTimer = setInterval(() => void runPriceSyncCycle(), env.PPOB_PRICE_SYNC_INTERVAL_MS);
  ppobPriceSyncTimer.unref();
  void runPriceSyncCycle();
}

/**
 * Sinkronisasi katalog pascabayar (BPJS, PDAM, dst), dengan saklar sendiri:
 * menyalakannya tidak menyalakan sinkronisasi harga prabayar.
 */
let ppobCatalogSyncTimer: NodeJS.Timeout | undefined;
if (env.PPOB_POSTPAID_CATALOG_SYNC_ENABLED && env.PPOB_PROVIDER === "digiflazz") {
  const catalogSyncService = new PpobPriceSyncService(
    new PrismaPpobRepository(prisma),
    DigiflazzPpobProvider.fromEnv()
  );
  const runCatalogSync = async () => {
    try {
      const result = await catalogSyncService.runPostpaidCatalogSync();
      if (!result.skipped) {
        logger.info(result, "PPOB postpaid catalog sync completed");
      }
    } catch (error) {
      logger.error({ err: error }, "PPOB postpaid catalog sync failed");
    }
  };
  ppobCatalogSyncTimer = setInterval(() => void runCatalogSync(), env.PPOB_PRICE_SYNC_INTERVAL_MS);
  ppobCatalogSyncTimer.unref();
  void runCatalogSync();
}

const server = httpServer.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, "TapGo backend is running");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down server");
  clearInterval(purgeTimer);
  clearInterval(rideSearchTimer);
  if (ppobReconcileTimer) {
    clearInterval(ppobReconcileTimer);
  }
  if (ppobPriceSyncTimer) {
    clearInterval(ppobPriceSyncTimer);
  }
  if (ppobCatalogSyncTimer) {
    clearInterval(ppobCatalogSyncTimer);
  }
  server.close(async () => {
    await redis?.quit();
    await disconnectRateLimitStore();
    await disconnectPrisma();
    process.exit(0);
  });
}

// .catch eksplisit (bukan cuma "void"): shutdown() tidak dibungkus try/catch
// sendiri, dan sejak M6 di atas SETIAP rejection tak tertangani menjatuhkan
// proses — kegagalan di tengah proses mati (mis. Redis/Prisma menolak
// disconnect) sudah semestinya tetap membuat proses berhenti, tapi harus
// lewat log fatal yang jelas, bukan meninggalkan rejection mentah.
process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    logger.fatal({ err: error }, "Shutdown gagal — proses akan berhenti paksa");
    process.exit(1);
  });
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    logger.fatal({ err: error }, "Shutdown gagal — proses akan berhenti paksa");
    process.exit(1);
  });
});
