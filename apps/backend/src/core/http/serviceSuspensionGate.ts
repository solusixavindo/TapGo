import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";
import type { SuspensionReader } from "../../modules/service-suspension/application/ServiceSuspensionService.js";

/**
 * Jalur yang tetap hidup saat layanan dihentikan. Dipasang pada
 * `app.use("/api/v1", ...)`, jadi `req.path` TANPA awalan /api/v1.
 *
 * - /admin: pemilik tetap bisa memeriksa dan memulihkan lewat konsol.
 * - /webhooks, /payments/midtrans/notification: pemberitahuan dari penyedia
 *   pembayaran untuk dana yang sudah berjalan tetap harus dicatat.
 * - /account: hak pengguna atas data mereka (permintaan hapus akun).
 */
const ALLOWED_PREFIXES = ["/admin", "/webhooks", "/payments/midtrans/notification", "/account"];

export function isSuspensionExempt(path: string, isMobileClient = false): boolean {
  if (ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }
  // Konsol admin masuk lewat /auth/*; tanpa ini pemilik terkunci dari konsol.
  // Aplikasi HP (user_app/driver_app) selalu mengirim header identitas dan tetap diblokir.
  return !isMobileClient && (path === "/auth" || path.startsWith("/auth/"));
}

function isMobileClient(req: Request): boolean {
  return Boolean(req.header("x-tapgo-platform")?.trim() || req.header("x-tapgo-app")?.trim());
}

/**
 * Menghentikan layanan secara terkendali dan dapat dibalik: tidak mengubah
 * data, hanya menjawab 503 dengan pesan yang jelas agar aplikasi menampilkan
 * kesalahan yang bisa dipahami pengguna. Status dibaca dari database (diubah
 * hanya oleh SUPER_ADMIN_VIP), bukan dari variabel lingkungan.
 */
export function createServiceSuspensionGate(reader: SuspensionReader) {
  return async function serviceSuspensionGate(req: Request, _res: Response, next: NextFunction) {
    try {
      if (isSuspensionExempt(req.path, isMobileClient(req))) {
        return next();
      }
      const state = await reader.current();
      if (!state.suspended) {
        return next();
      }
      return next(new AppError(state.message, StatusCodes.SERVICE_UNAVAILABLE, "SERVICE_SUSPENDED"));
    } catch (error) {
      return next(error);
    }
  };
}
