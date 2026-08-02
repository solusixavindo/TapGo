import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { normalizePhoneNumber } from "./phone.js";

/**
 * Kunci rate limit untuk identifier pemulihan.
 *
 * Identifier di-hash sebelum dipakai sebagai kunci agar nomor telepon dan
 * email tidak tersimpan mentah di store rate limiter. Hash tanpa kunci sudah
 * memadai di sini: nilainya hanya hidup di memori proses dan bukan batas
 * keamanan — batas keamanan sesungguhnya ada pada digest ber-kunci di
 * core/security/otpDigest.ts.
 */
function recoveryIdentifierKey(req: { body?: unknown; ip?: string | undefined }): string {
  const body = req.body as { identifier?: unknown } | undefined;
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier) {
    return `recovery-ip:${req.ip ?? "unknown"}`;
  }
  const normalized = identifier.includes("@")
    ? identifier.toLowerCase()
    : normalizePhoneNumber(identifier);
  return `recovery-id:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
}

const recoveryRateLimitMessage = {
  success: false,
  code: "AUTH_RECOVERY_RATE_LIMITED",
  message: "Terlalu banyak permintaan pemulihan. Silakan coba lagi nanti."
};

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many authentication attempts. Please try again later."
  }
});

export const registerPhoneRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    return phone ? `register-phone:${normalizePhoneNumber(phone)}` : `register-ip:${req.ip ?? "unknown"}`;
  },
  message: {
    success: false,
    code: "REGISTER_PHONE_RATE_LIMITED",
    message: "Terlalu banyak percobaan registrasi untuk nomor ini. Silakan coba lagi nanti."
  }
});

/**
 * Batas per akun target. Menahan pengeboman OTP ke satu nomor/email walau
 * penyerang berpindah-pindah IP.
 */
export const recoveryAccountRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: recoveryIdentifierKey,
  message: recoveryRateLimitMessage
});

/**
 * Batas per IP. Menahan penyapuan banyak akun dari satu sumber, termasuk
 * upaya enumerasi lewat pengukuran waktu respons.
 */
export const recoveryIpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: recoveryRateLimitMessage
});

/**
 * Batas percobaan OTP di lapisan transport. Batas per-tantangan yang
 * otoritatif tetap berada di database (kolom attempts/max_attempts); ini
 * lapisan kedua agar percobaan tidak pernah sampai ke database sama sekali.
 */
export const recoveryVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: recoveryIdentifierKey,
  message: recoveryRateLimitMessage
});

/** Batas permintaan OTP verifikasi untuk pengguna yang sudah login. */
export const verificationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `verification-user:${req.auth?.userId ?? req.ip ?? "unknown"}`,
  message: recoveryRateLimitMessage
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

export const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many admin requests. Please try again later."
  }
});

export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many payment requests. Please try again later."
  }
});

/** Pembuatan quote/order ride — aksi bernilai, dibatasi lebih ketat. */
export const rideWriteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RIDE_RATE_LIMITED",
    message: "Terlalu banyak permintaan perjalanan. Silakan coba lagi nanti."
  }
});

/** Update lokasi driver — frekuensi tinggi tetapi tetap dibatasi. */
export const rideLocationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RIDE_LOCATION_RATE_LIMITED",
    message: "Terlalu banyak pembaruan lokasi. Silakan coba lagi nanti."
  }
});

export const supportRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "SUPPORT_RATE_LIMITED",
    message: "Terlalu banyak permintaan bantuan. Silakan coba lagi nanti."
  }
});
