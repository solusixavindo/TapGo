import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { JwtRole, verifyAccessToken } from "./tokenService.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: JwtRole;
        sessionId: string;
      };
    }
  }
}

export const AUTH_SESSION_REVOKED = "AUTH_SESSION_REVOKED";

/**
 * Pencabutan sesi yang otoritatif dari database.
 *
 * Access token berumur 15 menit dan sebelumnya tidak pernah diperiksa ke
 * database, sehingga reset password tidak benar-benar mencabut akses yang
 * sedang berjalan — token lama tetap sah sampai kedaluwarsa sendiri.
 *
 * Sekarang setiap permintaan terautentikasi membandingkan `iat` token dengan
 * `users.sessions_revoked_at`. Token yang diterbitkan sebelum pencabutan
 * ditolak seketika.
 *
 * Kenapa epoch pada User, bukan lookup baris Session:
 * memaksa keberadaan baris Session akan menolak setiap token yang tidak
 * diterbitkan lewat issueTokenPair. Epoch memberi pencabutan yang sama
 * kuatnya tanpa mengubah kontrak penerbitan token yang sudah ada.
 *
 * Biaya: satu pembacaan primary key per permintaan terautentikasi.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    next(new AppError("Missing bearer token", StatusCodes.UNAUTHORIZED, "AUTH_TOKEN_MISSING"));
    return;
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    next(error);
    return;
  }

  prisma.user
    .findUnique({
      where: { id: payload.sub },
      select: { sessionsRevokedAt: true }
    })
    .then((user) => {
      const revokedAt = user?.sessionsRevokedAt;
      if (revokedAt) {
        // FAIL-CLOSED. Bila epoch pencabutan aktif tetapi `iat` hilang atau
        // tidak berbentuk angka berhingga, umur token TIDAK dapat dibuktikan
        // lebih baru daripada pencabutan — maka token ditolak.
        //
        // Versi sebelumnya melewati pemeriksaan ketika `iat` undefined, yang
        // membuat token tanpa `iat` lolos melewati pencabutan sesi. Itu
        // fail-open dan merupakan bypass diam-diam.
        const issuedAt = payload.iat;
        const hasUsableIat = typeof issuedAt === "number" && Number.isFinite(issuedAt);

        // Perbandingan dilakukan pada granularitas DETIK di kedua sisi.
        //
        // `iat` hanya berpresisi detik, sedangkan sessions_revoked_at
        // berpresisi milidetik. Membandingkan langsung akan menolak token
        // yang diterbitkan pada detik yang sama dengan pencabutan — termasuk
        // login sah yang dilakukan pengguna tepat setelah reset password.
        // Itu mengunci pengguna keluar dari akunnya sendiri.
        //
        // Sisa celahnya adalah access token yang diterbitkan pada detik yang
        // sama persis dengan pencabutan. Menerbitkannya menuntut password
        // LAMA, yang pada saat itu juga sudah diganti, dan seluruh baris
        // Session sudah dicabut sehingga refresh mustahil. Risiko di bawah
        // satu detik ini diterima secara sadar; mengunci pengguna sah keluar
        // jauh lebih merugikan.
        const revokedAtSeconds = Math.floor(revokedAt.getTime() / 1000);
        if (!hasUsableIat || issuedAt < revokedAtSeconds) {
          throw new AppError(
            "Sesi sudah tidak berlaku. Silakan login kembali.",
            StatusCodes.UNAUTHORIZED,
            AUTH_SESSION_REVOKED
          );
        }
      }

      req.auth = {
        userId: payload.sub,
        role: payload.role,
        sessionId: payload.sessionId
      };
      next();
    })
    .catch(next);
}

export function requireRoles(...roles: JwtRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new AppError("Authentication required", StatusCodes.UNAUTHORIZED, "AUTH_REQUIRED");
    }

    if (!roles.includes(req.auth.role)) {
      throw new AppError("Insufficient permissions", StatusCodes.FORBIDDEN, "FORBIDDEN");
    }

    next();
  };
}
