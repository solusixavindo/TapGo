import { NextFunction, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Guard kapabilitas driver — otoritatif dari DATABASE, bukan dari klaim token.
 *
 * Latar: requireRoles hanya mencocokkan klaim `role` di dalam JWT dan tidak
 * pernah membaca database. Access token berumur 15 menit, sehingga driver yang
 * baru saja di-suspend masih dapat melewati pemeriksaan berbasis role sampai
 * tokennya kedaluwarsa. Guard ini menutup jendela tersebut dengan memeriksa
 * state terkini pada setiap request.
 *
 * Kapabilitas driver dimiliki bila dan hanya bila:
 *   1. RideDriverProfile milik user ada;
 *   2. User.status = ACTIVE;
 *   3. RideDriverProfile.status = ACTIVE.
 *
 * Role akun TIDAK dipakai sebagai sumber kewenangan. Registrasi publik selalu
 * membuat USER (Stage 5.8) dan satu akun dapat menjadi penumpang sekaligus
 * driver. ADMIN/SUPER_ADMIN TIDAK mendapat bypass: tanpa profil driver ACTIVE
 * mereka ditolak sama seperti akun lain. Bantuan/koreksi admin harus melalui
 * endpoint admin terpisah yang punya audit trail sendiri.
 *
 * Nama paket aplikasi, aplikasi yang terpasang, maupun sinyal apa pun dari
 * klien tidak pernah menjadi bagian dari keputusan ini.
 */
export function createRequireDriverCapability(prisma: PrismaClient) {
  return function requireDriverCapability(
    req: Request,
    _res: Response,
    next: NextFunction
  ) {
    const userId = req.auth?.userId;
    if (!userId) {
      next(
        new AppError(
          "Authentication required",
          StatusCodes.UNAUTHORIZED,
          "AUTH_REQUIRED"
        )
      );
      return;
    }

    prisma.rideDriverProfile
      .findUnique({
        where: { userId },
        select: { id: true, status: true, user: { select: { status: true } } }
      })
      .then((profile) => {
        // Profil tidak ada -> tidak pernah menjadi driver. Kode ini juga yang
        // muncul bila akun sudah dihapus, karena profil ikut ter-cascade.
        if (!profile) {
          throw new AppError(
            "Profil driver tidak ditemukan",
            StatusCodes.FORBIDDEN,
            "RIDE_DRIVER_PROFILE_REQUIRED"
          );
        }
        if (profile.user.status !== "ACTIVE") {
          throw new AppError(
            "Akun Anda tidak aktif",
            StatusCodes.FORBIDDEN,
            "RIDE_DRIVER_ACCOUNT_INACTIVE"
          );
        }
        if (profile.status !== "ACTIVE") {
          throw new AppError(
            "Akun driver belum aktif",
            StatusCodes.FORBIDDEN,
            "RIDE_DRIVER_NOT_ACTIVE"
          );
        }
        next();
      })
      .catch(next);
  };
}
