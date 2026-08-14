import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";
import { env } from "../../config/env.js";

/**
 * Digest untuk secret ber-entropi rendah (OTP 6 digit) dan untuk destination
 * (nomor telepon / email) yang tidak boleh disimpan mentah pada tabel challenge.
 *
 * Kenapa keyed HMAC, bukan argon2 seperti password:
 * OTP hanya memiliki 10^6 kemungkinan. Hash tanpa kunci — sekuat apa pun —
 * dapat di-brute-force offline oleh siapa pun yang memperoleh salinan database,
 * karena seluruh ruang pencarian dapat dihitung sebelumnya. Keyed HMAC membuat
 * serangan itu mustahil tanpa secret backend, yang tidak pernah berada di
 * database. Argon2 tetap dipakai untuk password (entropi tinggi, butuh
 * per-hash salt), bukan untuk OTP.
 *
 * Secret ini SENGAJA terpisah dari JWT, payment, database, KMS, dan identifier
 * HMAC driver. Kebocoran salah satu domain tidak boleh melemahkan domain lain.
 */

export const AUTH_RECOVERY_SECRET_UNAVAILABLE = "AUTH_RECOVERY_SECRET_UNAVAILABLE";

/** Panjang minimum yang sama dengan kebijakan secret lain di repo. */
export const MIN_AUTH_RECOVERY_SECRET_LENGTH = 32;

/** Versi kunci aktif, disimpan bersama digest agar rotasi mungkin dilakukan. */
export const AUTH_RECOVERY_KEY_VERSION = 1;

/** Pemisah domain: digest OTP dan digest destination tidak boleh saling tukar. */
type DigestDomain = "code" | "destination" | "reset-token";

const DIGEST_PREFIX = "tapgo.auth.recovery.v1";

/**
 * Fail-closed pada titik pemakaian, bukan saat boot.
 *
 * env.ts dimuat oleh logger dan tokenService di hampir seluruh test, sehingga
 * memaksa secret ada saat boot akan menumbangkan test yang tidak berhubungan.
 * Sebagai gantinya setiap operasi recovery menolak dengan 503 bila secret
 * belum dikonfigurasi. Tidak ada fallback, tidak ada default, tidak ada
 * secret yang ditanam di kode.
 */
function requireSecret(): string {
  const secret = env.AUTH_RECOVERY_HMAC_SECRET;
  if (!secret || secret.length < MIN_AUTH_RECOVERY_SECRET_LENGTH) {
    throw new AppError(
      "Layanan pemulihan akun belum tersedia.",
      StatusCodes.SERVICE_UNAVAILABLE,
      AUTH_RECOVERY_SECRET_UNAVAILABLE
    );
  }
  return secret;
}

/** True bila recovery dapat beroperasi. Dipakai health check, bukan alur user. */
export function isAuthRecoveryConfigured(): boolean {
  const secret = env.AUTH_RECOVERY_HMAC_SECRET;
  return Boolean(secret && secret.length >= MIN_AUTH_RECOVERY_SECRET_LENGTH);
}

function digest(domain: DigestDomain, value: string): string {
  const message = `${DIGEST_PREFIX}|domain=${domain}|keyVersion=${AUTH_RECOVERY_KEY_VERSION}|value=${value}`;
  return crypto.createHmac("sha256", requireSecret()).update(message, "utf8").digest("hex");
}

/** Digest OTP. Nilai mentah tidak pernah disimpan maupun dicatat. */
export function digestOtpCode(code: string): string {
  return digest("code", code);
}

/**
 * Digest destination (nomor/email). Membuat challenge dapat dicocokkan dengan
 * tujuan pengiriman tanpa menyimpan PII pada tabel challenge.
 */
export function digestDestination(destination: string): string {
  return digest("destination", destination.trim().toLowerCase());
}

/** Digest reset token yang diterbitkan setelah OTP terverifikasi. */
export function digestResetToken(token: string): string {
  return digest("reset-token", token);
}

/**
 * OTP 6 digit dari CSPRNG.
 *
 * `randomInt` menolak modulo bias; rentangnya eksklusif di batas atas sehingga
 * 100000..999999 memberi 900.000 nilai yang seragam. Digit pertama sengaja
 * bukan nol agar panjangnya selalu 6 saat ditampilkan.
 */
export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/** Reset token 256-bit untuk langkah set-password. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Perbandingan waktu-tetap untuk digest hex.
 *
 * timingSafeEqual melempar bila panjang buffer berbeda, jadi panjang diperiksa
 * lebih dulu — pemeriksaan panjang itu sendiri tidak membocorkan isi digest.
 */
export function digestEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
