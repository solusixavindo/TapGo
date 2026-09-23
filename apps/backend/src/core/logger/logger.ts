import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { Sentry } from "../monitoring/sentry.js";

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

/**
 * Level numerik Pino: fatal=60, error=50 (lihat dokumentasi Pino). >=50
 * mencakup keduanya tanpa perlu membandingkan string label.
 */
const SENTRY_LEVEL_THRESHOLD = 50;

/**
 * Nilai error dari argumen mergingObject sebuah pemanggilan log, mengikuti
 * DUA konvensi field yang keduanya sudah dipakai di codebase ini
 * (`{ err: error }` di beberapa tempat, `{ error }` di tempat lain) —
 * fallback ini menghindari perlu menyeragamkan seluruh pemanggil logger.error
 * lebih dulu sebelum forwarding ke Sentry bisa aktif. Sengaja TIDAK menuntut
 * `instanceof Error` — kode ini boleh saja melempar nilai bukan Error (mis.
 * string), dan Sentry.captureException menerima `unknown` apa adanya.
 */
function extractError(args: unknown[]): unknown {
  const first = args[0];
  if (first instanceof Error) return first;
  if (first && typeof first === "object") {
    const obj = first as Record<string, unknown>;
    if (obj.err !== undefined) return obj.err;
    if (obj.error !== undefined) return obj.error;
  }
  return undefined;
}

function extractMessage(args: unknown[]): string | undefined {
  return args.find((a): a is string => typeof a === "string");
}

/**
 * Forwarding otomatis SEMUA log level error/fatal ke Sentry — bukan hanya
 * error yang lewat errorHandler.ts. Sebelum ini, logger.error(...) yang
 * dipanggil langsung di berbagai service (mis. siklus rekonsiliasi PPOB,
 * sinkronisasi harga Digiflazz) tidak pernah terlihat di Sentry sama sekali,
 * hanya tercatat di log biasa. No-op tanpa SENTRY_DSN (lihat
 * core/monitoring/sentry.ts) — aman dipasang di sini terlepas environment.
 *
 * method.apply(this, args) TETAP dipanggil di semua kasus: hook ini murni
 * menambah efek samping, tidak pernah menahan/mengubah log yang sesungguhnya
 * ditulis pino.
 */
function sentryForwardingHook(this: pino.Logger, args: Parameters<pino.LogFn>, method: pino.LogFn, level: number) {
  if (level >= SENTRY_LEVEL_THRESHOLD) {
    const error = extractError(args);
    if (error) {
      Sentry.captureException(error);
    } else {
      const message = extractMessage(args);
      if (message) Sentry.captureMessage(message, "error");
    }
  }
  method.apply(this, args);
}

const errorFile = fileDestination("error.log");
export const logger = pino(
  {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    redact: redactConfig,
    formatters: levelFormatter,
    hooks: { logMethod: sentryForwardingHook }
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
