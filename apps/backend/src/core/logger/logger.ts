import pino from "pino";

/**
 * Logger sengaja TIDAK bergantung pada config/env.ts.
 *
 * env.ts di-parse eager saat diimpor dan mewajibkan DATABASE_URL, JWT secrets,
 * dsb. Logger diimpor hampir oleh semua modul — bila ia membaca env di tingkat
 * modul, maka setiap test/ tooling yang mengimpor logger (langsung maupun
 * transitif, mis. lewat rateLimitStore) ikut memaksa parse env sebelum env test
 * sempat disetel, dan gagal dimuat dengan ZodError. NODE_ENV adalah konvensi
 * Node yang aman dibaca langsung; tidak perlu lewat skema validasi penuh.
 */
export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.passwordHash",
      "req.body.refreshToken",
      "req.body.token",
      "req.body.snapToken",
      "req.body.signature_key",
      "req.body.DOKU_SECRET_KEY",
      "req.body.dokuSecretKey",
      "req.body.secretKey",
      "req.headers.signature",
      "req.headers.client-id",
      "password",
      "passwordHash",
      "refreshToken",
      "token",
      "snapToken",
      "signature_key",
      "signature",
      "secretKey",
      "DOKU_SECRET_KEY",
      "DOKU_API_KEY",
      // Identifier sensitif dan material blind index. Service identifierIndex
      // sendiri tidak pernah mencatat nilai apa pun; path ini adalah lapisan
      // pengaman kedua bila nilai terbawa lewat request body atau objek lain.
      "nik",
      "req.body.nik",
      "licenseNumber",
      "req.body.licenseNumber",
      "plateNumber",
      "req.body.plateNumber",
      "blindIndex",
      "identifierKey",
      "IDENTIFIER_INDEX_KEY_V1",
      "IDENTIFIER_INDEX_KEY_V2"
      ,
      // Material recovery akun. Service recovery sendiri tidak pernah
      // mencatat nilai apa pun; path ini adalah lapisan pengaman kedua bila
      // nilai terbawa lewat request body atau objek yang di-log.
      "code",
      "req.body.code",
      "otp",
      "req.body.otp",
      "otpCode",
      "resetToken",
      "req.body.resetToken",
      "newPassword",
      "req.body.newPassword",
      "confirmPassword",
      "req.body.confirmPassword",
      "identifier",
      "req.body.identifier",
      "destination",
      "phone",
      "req.body.phone",
      "email",
      "req.body.email",
      "AUTH_RECOVERY_HMAC_SECRET"
    ],
    censor: "[REDACTED]"
  },
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});
