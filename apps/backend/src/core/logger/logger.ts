import fs from "node:fs";
import path from "node:path";
import pino from "pino";

/**
 * Logger sengaja TIDAK bergantung pada config/env.ts.
 *
 * env.ts di-parse eager saat diimpor dan mewajibkan DATABASE_URL, JWT secrets,
 * dsb. Logger diimpor hampir oleh semua modul — bila ia membaca env di tingkat
 * modul, maka setiap test/ tooling yang mengimpor logger (langsung maupun
 * transitif, mis. lewat rateLimitStore) ikut memaksa parse env sebelum env test
 * sempat disetel, dan gagal dimuat dengan ZodError. NODE_ENV dan LOG_DIR adalah
 * konvensi yang aman dibaca langsung; tidak perlu lewat skema validasi penuh.
 */
const logDir = process.env.LOG_DIR;

/**
 * Tanpa LOG_DIR (dev/test/CI — nilai default), null di sini membuat `logger`/
 * `auditLogger` di bawah HANYA memakai stdout, identik dengan perilaku
 * sebelum perubahan ini. Dengan LOG_DIR (production compose), buat file
 * tujuan lewat pino.destination — sync:false supaya tidak memblokir event
 * loop, sama seperti stdout bawaan pino.
 */
function fileDestination(filename: string): pino.DestinationStream | null {
  if (!logDir) return null;
  fs.mkdirSync(logDir, { recursive: true });
  return pino.destination({ dest: path.join(logDir, filename), mkdir: true, sync: false });
}

const redactConfig = {
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
};

const levelFormatter = {
  level(label: string) {
    return { level: label };
  }
};

const errorFile = fileDestination("error.log");
export const logger = pino(
  {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    redact: redactConfig,
    formatters: levelFormatter
  },
  errorFile
    ? pino.multistream([{ stream: process.stdout }, { stream: errorFile, level: "error" }])
    : process.stdout
);

/**
 * Log audit tersendiri — TERPISAH dari error.log di atas, sesuai permintaan
 * "log transaksi/audit dipisah dari log error harian". Melengkapi (bukan
 * menggantikan) audit trail tabel AuditLog di database yang sudah jadi
 * sumber kebenaran utama (lihat 16+ pemanggil `auditLog.create` di seluruh
 * modul) — dipakai lewat auditRequestLogger di app.ts untuk mencatat semua
 * request ke rute admin/driver-review dalam bentuk yang bisa di-tail
 * langsung dari file, tanpa perlu query database.
 */
const auditFile = fileDestination("audit.log");
export const auditLogger = pino(
  {
    level: "info",
    redact: redactConfig,
    formatters: levelFormatter,
    base: { scope: "audit" }
  },
  auditFile ? pino.multistream([{ stream: process.stdout }, { stream: auditFile }]) : process.stdout
);
