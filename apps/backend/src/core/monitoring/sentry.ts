import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const LONG_DIGIT_RUN_PATTERN = /\d{6,}/g;

/**
 * Lapisan pertahanan KEDUA (audit keamanan 30 September 2026, M5): redaction
 * Pino di logger.ts bekerja per-path field terstruktur, tapi Bearer
 * token/JWT/nomor panjang (NIK, no. HP, no. rekening, OTP) bisa saja ikut
 * tercetak sebagai SUBSTRING pesan bebas (mis. exception.message dari
 * library pihak ketiga) yang tidak pernah lewat redact path manapun. Scrub
 * berbasis pola string ini menutup celah itu sebelum event dikirim ke
 * Sentry — melengkapi (bukan menggantikan) redact Pino.
 */
export function scrubSensitiveText(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(LONG_DIGIT_RUN_PATTERN, "[REDACTED_DIGITS]");
}

// Field yang di-redact PENUH berdasar nama key-nya (bukan hanya isi) —
// pasangan dari daftar redact Pino di logger.ts, untuk struktur event Sentry
// yang tidak selalu lewat Pino (mis. request/breadcrumbs bawaan SDK Sentry).
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|token|secret|signature|nik|otp|account.?number)/i;

const MAX_SCRUB_DEPTH = 8;

function scrubValue(value: unknown, keyHint: string | undefined, depth: number): unknown {
  if (depth > MAX_SCRUB_DEPTH) {
    return "[REDACTED_TOO_DEEP]";
  }
  if (typeof value === "string") {
    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
      return "[REDACTED]";
    }
    return scrubSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, keyHint, depth + 1));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = scrubValue(val, key, depth + 1);
    }
    return result;
  }
  return value;
}

/**
 * Menyaring SELURUH struktur event Sentry (message, exception, breadcrumbs,
 * request, extra, contexts, dst) sebelum dikirim. Dipasang sebagai
 * beforeSend di initSentry() di bawah.
 */
export function scrubSentryEvent<T extends object>(event: T): T {
  return scrubValue(event, undefined, 0) as T;
}

/**
 * Fail-closed seperti PPOB_PROVIDER=disabled dan pola lain di codebase ini:
 * tanpa SENTRY_DSN, initSentry() tidak melakukan apa pun — Sentry.captureException()
 * yang dipanggil di tempat lain (errorHandler.ts, server.ts) tetap aman dipanggil
 * kapan saja karena SDK Sentry sendiri sudah didesain no-op sebelum init()
 * (lihat dokumentasi resmi Sentry Node SDK).
 *
 * Sengaja baca process.env langsung, BUKAN config/env.ts — dipanggil sebagai
 * baris pertama server.ts, sebelum modul lain (termasuk env.ts yang mewajibkan
 * banyak variabel lain) sempat diimpor, supaya crash sedini mungkin pun
 * tertangkap Sentry bila DSN sudah ada.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // 10%: cukup untuk gambaran performa tanpa membebani kuota Sentry.
    // Naikkan lewat env terpisah nanti bila benar-benar dibutuhkan analisis
    // performa yang lebih rinci — bukan keputusan yang perlu diambil sekarang.
    tracesSampleRate: 0.1,
    // Profiling hanya berjalan di dalam transaction yang sudah disample di
    // atas (tracesSampleRate), jadi relatif ini terhadap traces — bukan 10%
    // dari SELURUH request. Sama alasannya: cukup untuk gambaran fungsi mana
    // yang lambat, tanpa membebani CPU produksi.
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    beforeSend(event) {
      return scrubSentryEvent(event);
    }
  });
}

export { Sentry };
