import { Redis } from "ioredis";
import type { Store } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import type { RedisReply } from "rate-limit-redis";
import { logger } from "../logger/logger.js";

/**
 * Penyimpanan bersama untuk rate limit.
 *
 * MASALAH YANG DISELESAIKAN
 *
 * Seluruh limiter di rateLimit.ts sebelumnya memakai MemoryStore bawaan
 * express-rate-limit — hitungan per PROSES, di dalam RAM. Padahal Redis sudah
 * terkonfigurasi di config/redis.ts dan tidak dipakai untuk apa pun.
 *
 * Akibatnya pada deployment multi-proses (PM2 cluster, atau beberapa instance di
 * belakang Nginx), batas yang tertulis di kode bukan batas yang berlaku:
 *
 *   - "3 permintaan OTP per 15 menit" menjadi 3 x jumlah proses;
 *   - "5 registrasi per nomor per jam" menjadi 5 x jumlah proses;
 *   - "20 percobaan login per 15 menit" menjadi 20 x jumlah proses;
 *   - setiap restart/deploy mereset seluruh hitungan ke nol.
 *
 * Batas per-akun dan per-IP pada alur pemulihan dipasang berlapis justru karena
 * masing-masing dapat dilewati sendiri-sendiri. Lapisan itu tidak berarti apa-apa
 * bila hitungannya tidak dibagi antar proses.
 *
 * KEBIJAKAN SAAT REDIS BERMASALAH
 *
 * Tidak seragam, dan itu keputusan sadar. Lihat `RateLimitFailureMode`.
 */

/**
 * Perilaku ketika store gagal dihubungi.
 *
 * - "closed": permintaan ikut gagal. Dipakai untuk limiter yang MELINDUNGI
 *   kredensial — login, ganti password, registrasi, OTP, pemulihan akun.
 *   Meloloskan permintaan di sini berarti mematikan proteksi brute-force tepat
 *   pada saat sistem sedang tidak sehat, dan itu jendela yang justru dicari
 *   penyerang. Gangguan Redis yang membuat login tidak tersedia akan segera
 *   terlihat dan ditangani; proteksi brute-force yang diam-diam nonaktif tidak.
 *
 * - "open": permintaan diloloskan. Dipakai untuk limiter lalu lintas umum
 *   (API global, admin, pembayaran, ride, support). Membuat SELURUH API mati
 *   karena Redis terganggu adalah pertukaran yang buruk — batas di sini menjaga
 *   kapasitas, bukan kredensial.
 */
export type RateLimitFailureMode = "closed" | "open";

const KEY_PREFIX = "tapgo:rl:";

/**
 * Klien Redis khusus rate limit.
 *
 * Dibuat lazily pada pemakaian pertama dan dibagi seluruh limiter. `null` bila
 * RATE_LIMIT_REDIS_URL tidak disetel — dan dalam keadaan itu limiter kembali
 * memakai MemoryStore, yang hanya benar untuk deployment satu proses.
 *
 * Kenapa lazy (bukan saat modul dimuat): `env` dari config/env.ts di-parse saat
 * pertama kali dibaca. Membaca `env` di tingkat modul memaksa parse itu terjadi
 * begitu file ini diimpor — dan file ini diimpor oleh rateLimit.ts yang dipakai
 * test integration SEBELUM sempat menyetel DATABASE_URL/JWT di beforeAll, hingga
 * modul gagal dimuat dengan ZodError. Dengan membaca env di dalam fungsi,
 * parse baru terjadi saat limiter benar-benar dipakai (setelah env siap).
 */
let rateLimitRedis: Redis | null | undefined;
let redisLogged = false;

function getRateLimitRedis(): Redis | null {
  if (rateLimitRedis !== undefined) {
    return rateLimitRedis;
  }
  // Baca dua nilai ini langsung dari process.env, BUKAN dari config/env.ts:
  // mengimpor env.ts akan mem-parse seluruh skema (mewajibkan DATABASE_URL,
  // JWT, dsb.) begitu modul ini diimpor — padahal modul ini diimpor oleh
  // rateLimit.ts sebelum test integration menyetel env tersebut. RATE_LIMIT_REDIS_URL
  // dan NODE_ENV keduanya opsional untuk jalur ini, jadi aman dibaca mentah.
  const redisUrl = process.env.RATE_LIMIT_REDIS_URL;
  const nodeEnv = process.env.NODE_ENV;

  if (!redisUrl) {
    rateLimitRedis = null;
    if (!redisLogged) {
      redisLogged = true;
      if (nodeEnv === "production") {
        // Sengaja level error, bukan warn: pada deployment multi-proses ini
        // berarti batas yang berlaku tidak sama dengan batas yang tertulis di kode.
        logger.error(
          { rateLimitStore: "memory" },
          "RATE_LIMIT_REDIS_URL is not set — rate limits are per-process and reset on restart. " +
            "Set it unless this deployment runs exactly one process."
        );
      } else {
        logger.info(
          { rateLimitStore: "memory" },
          "Rate limit counters are per-process (RATE_LIMIT_REDIS_URL not set)"
        );
      }
    }
    return rateLimitRedis;
  }

  rateLimitRedis = new Redis(redisUrl, {
    // Rate limiting adalah jalur panas pada setiap permintaan. Menahan
    // permintaan lama-lama demi menghitung kuota justru memindahkan gangguan
    // Redis menjadi latensi API, jadi batasi percobaannya. Setelah batas ini
    // tercapai, perintah yang masih menggantung ditolak — dan penolakan itulah
    // yang membuat kebijakan open/closed di bawah sempat berlaku.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true
    // enableOfflineQueue SENGAJA dibiarkan pada nilai bawaannya (true).
    //
    // Mematikannya terlihat lebih tegas, tetapi salah di sini: constructor
    // RedisStore langsung mengirim dua perintah SCRIPT LOAD untuk memuat skrip
    // Lua-nya, dan store dibentuk saat modul dimuat — jauh sebelum socket
    // Redis siap. Tanpa antrean offline, kedua perintah itu gagal seketika
    // dengan "Stream isn't writeable" pada setiap boot yang sehat sekalipun,
    // dan store berjalan tanpa script hash.
  });

  // ioredis melempar 'error' sebagai event. EventEmitter tanpa listener 'error'
  // akan MENJATUHKAN proses, jadi handler ini wajib ada — bukan sekadar demi log.
  rateLimitRedis.on("error", (error: Error) => {
    logger.error({ err: error, scope: "rate-limit-redis" }, "Rate limit Redis error");
  });

  if (!redisLogged) {
    redisLogged = true;
    logger.info({ rateLimitStore: "redis" }, "Rate limit counters are shared through Redis");
  }

  return rateLimitRedis;
}

/**
 * Opsi store untuk satu limiter.
 *
 * `name` menjadi bagian kunci Redis supaya limiter yang berbeda tidak pernah
 * saling menghabiskan kuota. Tanpa prefiks per-limiter, satu IP yang menghabiskan
 * kuota API global juga akan terhitung sudah menghabiskan kuota loginnya.
 *
 * Mengembalikan objek yang siap disebar ke rateLimit(), bukan store mentah,
 * karena `passOnStoreError` harus ikut ditetapkan bersamanya — keduanya satu
 * keputusan, dan memisahkannya membuat limiter baru mudah lupa menyetel salah
 * satunya.
 */
export function rateLimitStore(
  name: string,
  failureMode: RateLimitFailureMode
): { store?: Store; passOnStoreError: boolean } {
  const passOnStoreError = failureMode === "open";

  const redis = getRateLimitRedis();
  if (!redis) {
    // MemoryStore tidak pernah gagal, jadi passOnStoreError tidak berpengaruh.
    return { passOnStoreError };
  }

  const store = new RedisStore({
    // rate-limit-redis berkomunikasi lewat satu fungsi perintah, sehingga
    // klien apa pun dapat dipakai. Bentuk dua-argumen `call(command, args[])`
    // dipilih, bukan spread: overload varargs ioredis bertipe tuple dan tidak
    // menerima array dengan panjang yang tidak diketahui saat kompilasi.
    sendCommand: (...args: string[]) => {
      const [command, ...commandArgs] = args;
      return redis.call(
        command as string,
        commandArgs
      ) as Promise<RedisReply>;
    },
    prefix: `${KEY_PREFIX}${name}:`
  });

  markScriptLoadHandled(store, name);

  return { store, passOnStoreError };
}

/**
 * Menandai promise pemuatan skrip sebagai sudah ditangani.
 *
 * Constructor RedisStore memanggil loadIncrementScript() dan loadGetScript() lalu
 * MENYIMPAN promise-nya untuk di-await belakangan pada setiap increment. Bila
 * Redis benar-benar tidak dapat dihubungi, kedua promise itu ditolak tanpa ada
 * yang menangkapnya saat itu — dan Node melaporkannya sebagai unhandledRejection,
 * yang pada konfigurasi tertentu menjatuhkan proses.
 *
 * Melekatkan .catch() di sini menandainya sudah ditangani TANPA menelan
 * kegagalannya: setiap `await` atas promise yang sama tetap menerima penolakannya,
 * sehingga increment tetap gagal dan kebijakan open/closed tetap berlaku. Yang
 * hilang hanyalah laporan unhandledRejection-nya.
 */
function markScriptLoadHandled(store: Store, name: string) {
  const scriptPromises = store as unknown as {
    incrementScriptSha?: Promise<unknown>;
    getScriptSha?: Promise<unknown>;
  };

  for (const promise of [scriptPromises.incrementScriptSha, scriptPromises.getScriptSha]) {
    promise?.catch((error: unknown) => {
      logger.error(
        { err: error, scope: "rate-limit-redis", limiter: name },
        "Failed to load rate limit Lua script into Redis"
      );
    });
  }
}

/** Menutup koneksi saat shutdown. Aman dipanggil walau Redis tidak dipakai. */
export async function disconnectRateLimitStore() {
  await rateLimitRedis?.quit();
}