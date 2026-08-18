import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Cabang Redis pada penyimpanan rate limit.
 *
 * Berkas ini terpisah dari rateLimitStore.test.ts karena harus memuat ulang modul
 * dengan RATE_LIMIT_REDIS_URL terpasang: env.ts membaca process.env sekali saat
 * diimpor, sehingga menyetel variabelnya setelah itu tidak berpengaruh.
 *
 * Yang diuji hanyalah PERAKITAN store — bahwa RedisStore benar-benar terbentuk
 * dan adaptor sendCommand-nya terpasang. Perilaku hitungannya tidak diuji di
 * sini karena itu menuntut Redis yang berjalan; alamat di bawah sengaja
 * mengarah ke port yang pasti kosong.
 *
 * Log galat koneksi saat berkas ini berjalan adalah HASIL YANG DIHARAPKAN, bukan
 * kegagalan: alamatnya memang mati. Yang penting adalah galat itu muncul sebagai
 * log yang tertangani, bukan sebagai unhandledRejection. Constructor RedisStore
 * mengirim dua SCRIPT LOAD dan menyimpan promise-nya untuk di-await belakangan,
 * sehingga tanpa penanganan eksplisit di rateLimitStore.ts penolakannya lolos
 * sebagai unhandledRejection — dan berkas uji ini yang menemukannya.
 */

const DEAD_REDIS_URL = "redis://127.0.0.1:1";

let rateLimitStore: typeof import("../../src/core/security/rateLimitStore.js")["rateLimitStore"];
let disconnectRateLimitStore: typeof import("../../src/core/security/rateLimitStore.js")["disconnectRateLimitStore"];

describe("rateLimitStore dengan Redis", () => {
  beforeAll(async () => {
    vi.stubEnv("RATE_LIMIT_REDIS_URL", DEAD_REDIS_URL);
    // Memaksa env.ts dan rateLimitStore.ts dibaca ulang dengan variabel di atas.
    vi.resetModules();
    const moduleUnderTest = await import("../../src/core/security/rateLimitStore.js");
    rateLimitStore = moduleUnderTest.rateLimitStore;
    disconnectRateLimitStore = moduleUnderTest.disconnectRateLimitStore;
  });

  afterAll(async () => {
    // Wajib: tanpa ini klien ioredis terus mencoba menyambung ke port mati dan
    // menahan proses uji tetap hidup.
    await disconnectRateLimitStore().catch(() => undefined);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("membentuk store Redis", () => {
    expect(rateLimitStore("uji-redis", "open").store).toBeDefined();
  });

  it("tetap menetapkan kebijakan kegagalan pada jalur Redis", () => {
    expect(rateLimitStore("uji-redis-closed", "closed")).toMatchObject({
      passOnStoreError: false
    });
    expect(rateLimitStore("uji-redis-open", "open")).toMatchObject({
      passOnStoreError: true
    });
  });

  it("memberi prefiks berbeda untuk nama limiter berbeda", () => {
    const first = rateLimitStore("limiter-satu", "open").store as { prefix?: string };
    const second = rateLimitStore("limiter-dua", "open").store as { prefix?: string };

    // Prefiks itulah yang mencegah dua limiter saling menghabiskan kuota.
    expect(first.prefix).toBe("tapgo:rl:limiter-satu:");
    expect(second.prefix).toBe("tapgo:rl:limiter-dua:");
  });
});
