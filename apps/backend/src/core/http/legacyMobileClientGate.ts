import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";

const MOBILE_PLATFORMS = new Set(["android", "ios"]);

/**
 * Menolak build user_app lama yang masih beredar (Owner, 2026-09-24).
 *
 * Yang bisa dibedakan server: build yang terbit sebelum 2026-09-19 tidak
 * mengirim `X-TapGo-Distribution`; semua build sesudahnya mengirimnya
 * ("play" atau "direct"). `X-TapGo-App-Version` TIDAK bisa dipakai: sebelum
 * perbaikan ini semua build mengirim konstanta '1.0.3+4'. Karena itu batas
 * penolakan adalah 2026-09-19, bukan 25 Juli; pengguna Play di build 25 Juli
 * s.d. 18 September ikut ditolak sampai memperbarui dari Google Play.
 *
 * Hanya menyentuh klien yang mengaku android/ios. Konsol web, driver_app,
 * webhook penyedia, dan health check tidak mengirim header platform sehingga
 * tidak terpengaruh. Default MATI (fail-safe): nyalakan lewat
 * MOBILE_LEGACY_CLIENT_BLOCK_ENABLED=true setelah pengguna sempat memperbarui.
 *
 * Batas build minimum (Owner, 2026-09-25): MOBILE_MIN_APP_BUILD=32 menolak
 * juga build 2.0.0+..2.0.4+31 yang sudah mengirim header distribusi. Aman
 * karena build baru mengirim versi nyata; "unknown" tidak ditolak.
 *
 * driver_app (E4, 2026-09-30): mengirim `X-TapGo-App: driver` sejak build
 * 1.0.0+4. Baris itu dicabang KE FUNGSI TERPISAH ([driverMinAppBuildGate])
 * dengan env sendiri (DRIVER_MIN_APP_BUILD) SEBELUM logika user_app di bawah
 * ini sempat jalan — driver_app dan user_app kadang mengirim
 * `x-tapgo-platform: android` yang SAMA, jadi tanpa pencabangan ini nomor
 * build driver bisa salah dibandingkan dengan ambang batas milik user_app.
 */
export function legacyMobileClientGate(req: Request, res: Response, next: NextFunction) {
  if (req.header("x-tapgo-app")?.trim().toLowerCase() === "driver") {
    return driverMinAppBuildGate(req, res, next);
  }
  if (!env.MOBILE_LEGACY_CLIENT_BLOCK_ENABLED) {
    return next();
  }
  const platform = req.header("x-tapgo-platform")?.trim().toLowerCase();
  if (!platform || !MOBILE_PLATFORMS.has(platform)) {
    return next();
  }
  if (req.header("x-tapgo-distribution")?.trim()) {
    // Build baru mengirim versi nyata ("2.0.5+32"). Batas build minimum
    // menolak build yang lebih lama walau sudah mengirim header distribusi.
    // "unknown" (sebelum PackageInfo termuat) atau bentuk tak terbaca
    // dilewatkan: yang sudah membawa header distribusi bukan build lama.
    const minBuild = env.MOBILE_MIN_APP_BUILD;
    if (minBuild > 0) {
      const build = parseBuildNumber(req.header("x-tapgo-app-version"));
      if (build !== null && build < minBuild) {
        return next(updateRequired());
      }
    }
    return next();
  }
  return next(updateRequired());
}

/**
 * Gerbang versi minimum driver_app (E4). Berbeda dari alur user_app di atas:
 * driver_app TIDAK punya sejarah build yang mengirim header sebagian —
 * `X-TapGo-App: driver` baru mulai dikirim persis di build yang sama dengan
 * seluruh header lain (1.0.0+4), jadi tidak perlu aturan "tolak bila header
 * distribusi hilang" seperti user_app. Build sebelum 1.0.0+4 tidak mengirim
 * `X-TapGo-App` sama sekali sehingga tidak pernah masuk cabang ini.
 */
function driverMinAppBuildGate(req: Request, _res: Response, next: NextFunction) {
  if (!env.DRIVER_LEGACY_CLIENT_BLOCK_ENABLED) {
    return next();
  }
  const minBuild = env.DRIVER_MIN_APP_BUILD;
  if (minBuild > 0) {
    const build = parseBuildNumber(req.header("x-tapgo-app-version"));
    if (build !== null && build < minBuild) {
      return next(updateRequired());
    }
  }
  return next();
}

/** Angka setelah '+' pada "2.0.5+32"; null bila tidak ada atau bukan angka. */
export function parseBuildNumber(version: string | undefined): number | null {
  const match = /\+(\d{1,9})$/.exec(version?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

function updateRequired() {
  return new AppError(
    "Versi aplikasi ini sudah tidak didukung. Silakan perbarui TapGo dari Google Play.",
    StatusCodes.UPGRADE_REQUIRED,
    "APP_UPDATE_REQUIRED"
  );
}
