import jwt, {
  JsonWebTokenError,
  NotBeforeError,
  SignOptions,
  TokenExpiredError
} from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";

export type JwtRole = UserRole;

export type AccessTokenPayload = {
  sub: string;
  role: JwtRole;
  sessionId: string;
};

type JwtExpiresIn = NonNullable<SignOptions["expiresIn"]>;

function sign(payload: AccessTokenPayload, secret: string, options: SignOptions) {
  return jwt.sign(payload, secret, {
    issuer: "tapgo-api",
    audience: "tapgo-apps",
    ...options
  });
}

function expiresIn(value: string): JwtExpiresIn {
  return value as JwtExpiresIn;
}

export function signAccessToken(payload: AccessTokenPayload) {
  return sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: expiresIn(env.JWT_ACCESS_TTL) });
}

export function signRefreshToken(payload: AccessTokenPayload) {
  return sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: expiresIn(`${env.JWT_REFRESH_TTL_DAYS}d`) });
}

/**
 * Verifikasi JWT dengan semantik kegagalan yang stabil.
 *
 * HANYA kegagalan verifikasi JWT yang dipetakan menjadi 401 (token
 * kedaluwarsa/tidak valid/signature salah/audience & issuer salah). Error jenis
 * lain (mis. kegagalan internal) sengaja dilempar kembali apa adanya agar tidak
 * pernah tersamarkan menjadi 401. Pesan yang dikembalikan tidak memuat isi
 * token, detail verifikasi, maupun pesan asli dari library.
 */
function verifyToken(token: string, secret: string): AccessTokenPayload {
  try {
    return jwt.verify(token, secret, {
      issuer: "tapgo-api",
      audience: "tapgo-apps"
    }) as AccessTokenPayload;
  } catch (error) {
    // TokenExpiredError & NotBeforeError adalah turunan JsonWebTokenError,
    // sehingga pemeriksaan yang lebih spesifik harus lebih dulu.
    if (error instanceof TokenExpiredError) {
      throw new AppError(
        "Sesi Anda sudah berakhir. Silakan masuk kembali.",
        StatusCodes.UNAUTHORIZED,
        "AUTH_TOKEN_EXPIRED"
      );
    }
    if (error instanceof NotBeforeError || error instanceof JsonWebTokenError) {
      throw new AppError(
        "Token autentikasi tidak valid.",
        StatusCodes.UNAUTHORIZED,
        "AUTH_TOKEN_INVALID"
      );
    }
    throw error;
  }
}

export function verifyAccessToken(token: string) {
  return verifyToken(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token: string) {
  return verifyToken(token, env.JWT_REFRESH_SECRET);
}
