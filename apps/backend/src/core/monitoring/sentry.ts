import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

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
    integrations: [nodeProfilingIntegration()]
  });
}

export { Sentry };
