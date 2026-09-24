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
    return next();
  }
  return next(
    new AppError(
      "Versi aplikasi ini sudah tidak didukung. Silakan perbarui TapGo dari Google Play.",
      StatusCodes.UPGRADE_REQUIRED,
      "APP_UPDATE_REQUIRED"
    )
  );
}
