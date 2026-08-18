import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rateLimitStore } from "../../src/core/security/rateLimitStore.js";

/**
 * Penjaga penyimpanan rate limit.
 *
 * Seluruh limiter dulu memakai MemoryStore per-proses, sementara Redis sudah
 * terkonfigurasi dan tidak dipakai. Di deployment multi-proses itu berarti batas
 * yang tertulis di kode bukan batas yang berlaku — "3 permintaan OTP per 15
 * menit" menjadi 3 x jumlah proses, dan setiap restart mereset hitungannya.
 *
 * Uji di berkas ini menjaga dua hal:
 *
 * 1. Kebijakan kegagalan store terbaca benar dari nama modenya.
 * 2. TIDAK ADA limiter yang lupa memakai store bersama. Ini pemeriksaan tingkat
 *    sumber, dan memang disengaja: express-rate-limit tidak memaparkan opsi
 *    limiter yang sudah terbentuk, sehingga satu-satunya cara memastikan setiap
 *    limiter menyebarnya adalah membaca berkasnya. Regresinya nyata dan sunyi —
 *    limiter yang lupa menyebar store tetap berfungsi di pengembangan satu
 *    proses dan baru menjadi masalah di produksi.
 */

const RATE_LIMIT_SOURCE = readFileSync(
  new URL("../../src/core/security/rateLimit.ts", import.meta.url),
  "utf8"
);

describe("rateLimitStore", () => {
  // Uji ini berjalan tanpa RATE_LIMIT_REDIS_URL, sehingga store-nya tidak
  // terbentuk dan limiter kembali ke MemoryStore. Yang diperiksa di sini adalah
  // kebijakan kegagalannya, yang tetap ditetapkan pada kedua jalur.
  it("meloloskan permintaan saat store bermasalah pada mode open", () => {
    expect(rateLimitStore("uji-open", "open").passOnStoreError).toBe(true);
  });

  it("menggagalkan permintaan saat store bermasalah pada mode closed", () => {
    expect(rateLimitStore("uji-closed", "closed").passOnStoreError).toBe(false);
  });

  it("tidak membentuk store Redis bila RATE_LIMIT_REDIS_URL tidak disetel", () => {
    expect(rateLimitStore("uji-memory", "open").store).toBeUndefined();
  });
});

describe("kelengkapan konfigurasi limiter", () => {
  it("setiap limiter memakai store bersama", () => {
    const limiterCount = RATE_LIMIT_SOURCE.match(/\brateLimit\(\{/g)?.length ?? 0;
    const storeCount = RATE_LIMIT_SOURCE.match(/\.\.\.rateLimitStore\(/g)?.length ?? 0;

    // Pemeriksaan bahwa ADA limiter, supaya perubahan pola penulisan yang membuat
    // regex tidak lagi cocok tidak lolos sebagai "0 sama dengan 0".
    expect(limiterCount).toBeGreaterThan(10);
    expect(storeCount).toBe(limiterCount);
  });

  it("nama store tidak ada yang kembar", () => {
    const names = [...RATE_LIMIT_SOURCE.matchAll(/\.\.\.rateLimitStore\("([^"]+)"/g)].map(
      (match) => match[1]
    );

    expect(names.length).toBeGreaterThan(10);
    // Nama menjadi bagian kunci Redis. Nama kembar berarti dua limiter saling
    // menghabiskan kuota — satu IP yang menghabiskan kuota API global akan
    // terhitung sudah menghabiskan kuota loginnya juga.
    expect(new Set(names).size).toBe(names.length);
  });

  it("limiter yang melindungi kredensial memakai mode closed", () => {
    // Meloloskan permintaan saat store bermasalah berarti mematikan proteksi
    // brute-force tepat ketika sistem sedang tidak sehat.
    const credentialStores = [
      "auth",
      "register-phone",
      "recovery-account",
      "recovery-ip",
      "recovery-verify",
      "verification"
    ];

    for (const name of credentialStores) {
      expect(
        RATE_LIMIT_SOURCE,
        `limiter "${name}" wajib memakai mode closed`
      ).toContain(`...rateLimitStore("${name}", "closed")`);
    }
  });
});
