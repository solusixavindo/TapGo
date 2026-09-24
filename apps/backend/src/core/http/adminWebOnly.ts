import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";

const MOBILE_PLATFORMS = new Set(["android", "ios"]);

/**
 * Rute /api/v1/admin/* hanya untuk konsol web. Klien mobile TapGo (user_app,
 * driver_app) selalu mengirim `X-TapGo-Platform: android|ios`; konsol web tidak.
 *
 * Kenapa di server: build lama yang sudah terpasang di HP orang tidak bisa
 * kita ubah, dan sebelum 2026-09-19 user_app memang mengarahkan akun admin ke
 * dashboard admin (log produksi masih memperlihatkan aplikasi Android v1.0.3+4
 * memanggil /admin/members). Server adalah satu-satunya tempat yang masih kita
 * kendalikan untuk klien yang sudah beredar.
 *
 * Batasan yang sengaja dinyatakan jujur: ini menutup jalur paparan tak
 * disengaja dari aplikasi mobile, BUKAN pertahanan terhadap penyerang yang
 * memalsukan header. Kontrol akses sesungguhnya tetap autentikasi + peran.
 */
export function adminWebOnly(req: Request, _res: Response, next: NextFunction) {
  const platform = req.header("x-tapgo-platform")?.trim().toLowerCase();
  if (platform && MOBILE_PLATFORMS.has(platform)) {
    return next(
      new AppError("Fitur admin hanya tersedia di konsol web", StatusCodes.FORBIDDEN, "ADMIN_WEB_ONLY")
    );
  }
  next();
}
