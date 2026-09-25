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
 */
export function legacyMobileClientGate(req: Request, _res: Response, next: NextFunction) {
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
