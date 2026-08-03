import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { INITIAL_AUTH_VERSION, JwtRole, verifyAccessToken } from "./tokenService.js";

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
 * Pencabutan sesi berbasis VERSI, otoritatif dari database.
 *
 * Pendekatan sebelumnya membandingkan `iat` token dengan
 * `users.sessions_revoked_at`. Itu tidak memadai: `iat` hanya berpresisi
 * detik, sehingga token yang diterbitkan pada detik yang sama dengan
 * pencabutan lolos perbandingan — dan begitu lolos, ia tetap sah sampai TTL
 * 15 menitnya habis. Keputusan otorisasi tidak boleh bergantung pada presisi
 * jam.
 *
 * Sekarang token membawa claim `authVersion`, dan setiap permintaan menuntut
 * KESAMAAN PERSIS dengan `users.auth_version`. Pencabutan menaikkan kolom itu
 * satu langkah, sehingga seluruh token lama gugur seketika tanpa ambiguitas.
 *
 * Kebijakan kompatibilitas untuk token lama yang masih beredar:
 *   - token TANPA versi diterima hanya selama auth_version akun masih 0;
 *   - begitu auth_version melewati 0, token tanpa versi ditolak;
 *   - versi malformed — bukan integer, negatif, NaN, atau tak dikenal —
 *     ditolak, tanpa fallback diam-diam.
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
      select: { authVersion: true }
    })
    .then((user) => {
      // Baris user tidak ditemukan: TIDAK ada keputusan otorisasi yang dibuat
      // di sini, dan permintaan diteruskan seperti sebelumnya.
      //
      // Ini mempertahankan semantik yang sudah disetujui pada 59883f5 —
      // kegagalan internal tidak boleh tersamarkan menjadi 401. Token untuk
      // user yang tidak ada akan tetap gagal di lapisan bawah (mis. foreign
      // key AuditLog) dan muncul sebagai 500 yang jujur.
      //
      // Menolaknya di sini juga akan MELEBIHI mandat Stage R2.1A, yang
      // menyangkut perbandingan versi. Lihat laporan: kelayakan menolak token
      // milik akun yang sudah tidak ada dicatat sebagai pertimbangan terpisah
      // untuk Owner, bukan diputuskan diam-diam di sini.
      if (!user) {
        req.auth = {
          userId: payload.sub,
          role: payload.role,
          sessionId: payload.sessionId
        };
        next();
        return;
      }

      const currentVersion = user.authVersion;
      const tokenVersion = payload.authVersion;

      if (tokenVersion === undefined) {
        // Token lama tanpa claim versi. Hanya boleh diterima selama akun
        // belum pernah mengalami pencabutan sama sekali.
        if (currentVersion !== INITIAL_AUTH_VERSION) {
          throw new AppError(
            "Sesi sudah tidak berlaku. Silakan login kembali.",
            StatusCodes.UNAUTHORIZED,
            AUTH_SESSION_REVOKED
          );
        }
      } else {
        // Versi yang ada wajib berupa integer non-negatif dan sama persis.
        // Segala bentuk lain — string, pecahan, negatif, NaN, Infinity —
        // ditolak. Tidak ada koersi, tidak ada fallback.
        const usable =
          typeof tokenVersion === "number" &&
          Number.isInteger(tokenVersion) &&
          tokenVersion >= 0;

        if (!usable || tokenVersion !== currentVersion) {
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
