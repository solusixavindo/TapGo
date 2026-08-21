import "dotenv/config";
import { z } from "zod";

export const strictEnvBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
    return value;
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "staging", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().optional(),
  API_BASE_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  /* Kembali dimiliki: commit security "bagikan hitungan rate limit lewat Redis".
   * Opsional; tanpa nilai, rate limiter memakai penyimpanan dalam-memori
   * per-proses (hanya aman untuk deployment satu proses). */
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Secret khusus digest OTP/recovery. SENGAJA terpisah dari JWT, payment,
  // database, dan KMS: kebocoran satu domain tidak boleh melemahkan yang lain.
  // Optional di sini agar boot tidak gagal pada environment yang belum memakai
  // recovery; penegakannya fail-closed pada titik pemakaian, lihat
  // core/security/otpDigest.ts.
  AUTH_RECOVERY_HMAC_SECRET: z.string().min(32).optional(),
  /// Kunci enkripsi dokumen identitas (KTP dan swafoto) yang disimpan sementara
  /// di database. SENGAJA terpisah dari secret domain lain: kebocoran satu
  /// domain tidak boleh melemahkan domain lain.
  ///
  /// Kunci ini berada di environment, bukan di database, supaya salinan backup
  /// database saja tidak cukup untuk membuka dokumen. Optional agar boot tidak
  /// gagal pada environment yang belum memakai unggahan dokumen; penegakannya
  /// fail-closed pada titik pemakaian, lihat core/security/documentCipher.ts.
  MEMBERSHIP_DOCUMENT_SECRET: z.string().min(32).optional(),
  /// Masa simpan dokumen identitas di database, dalam jam. Keputusan Owner:
  /// 24 jam, setelah itu admin sudah mencetaknya sebagai berkas administrasi.
  MEMBERSHIP_DOCUMENT_RETENTION_HOURS: z.coerce.number().int().positive().max(72).default(24),
  /// Masa simpan dokumen driver. Keputusan Owner yang sama persis: 24 jam.
  ///
  /// Sengaja dipisah dari setelan membership supaya operasional dapat menahan
  /// satu jenis dokumen tanpa menyentuh yang lain saat menangani insiden. Nilai
  /// bawaannya WAJIB tetap sama — bila keduanya berbeda tanpa alasan, itu
  /// pertanda kebijakan sudah bergeser diam-diam, dan ada uji yang menjaganya.
  ///
  /// Secret enkripsinya memakai MEMBERSHIP_DOCUMENT_SECRET yang sama, tetapi
  /// kunci nyatanya diturunkan lewat label domain berbeda, sehingga dokumen
  /// driver tidak dapat dibuka dengan kunci dokumen membership.
  DRIVER_DOCUMENT_RETENTION_HOURS: z.coerce.number().int().positive().max(72).default(24),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_CLIENT_KEY: z.string().optional(),
  /// strictEnvBoolean, BUKAN z.coerce.boolean(). Coerce memakai Boolean(value),
  /// dan string "false" bernilai truthy — sehingga MIDTRANS_IS_PRODUCTION=false
  /// justru mengarahkan seluruh permintaan ke endpoint PRODUKSI. Persis
  /// kebalikan dari yang tertulis, pada flag yang menentukan uang sungguhan
  /// bergerak atau tidak.
  MIDTRANS_IS_PRODUCTION: strictEnvBoolean(false),
  MIDTRANS_NOTIFICATION_SECRET: z.string().optional(),
  MIDTRANS_SNAP_URL: z.string().url().optional(),
  // Satu flag ini dulu mengendalikan tiga hal sekaligus: visibilitas paket
  // berbayar, pembelian membership, dan pencairan saldo wallet. Akibatnya
  // menyalakan penjualan di web ikut membuka pencairan saldo di rilis Google
  // Play — permukaan yang justru sengaja ditutup. Sekarang ketiganya berdiri
  // sendiri, masing-masing fail closed.
  //
  // Dipertahankan sebagai master switch: bila false, ketiga kanal di bawah
  // ikut mati apa pun nilainya. Ini menjaga perilaku deployment lama.
  EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED: strictEnvBoolean(false),
  /// Pembelian membership lewat kanal web. Jalur A Stage R2.6.
  MEMBERSHIP_PURCHASE_WEB_ENABLED: strictEnvBoolean(false),
  /// Pembelian membership dari dalam aplikasi mobile. Tetap false untuk rilis
  /// Google Play: pembelian di dalam app menuntut Play Billing.
  MEMBERSHIP_PURCHASE_APP_ENABLED: strictEnvBoolean(false),
  /// Pencairan saldo wallet. Terpisah penuh dari pembelian membership.
  WALLET_CASH_OUT_ENABLED: strictEnvBoolean(false),
  // Release 1 tidak memakai realtime/chat. Fail-closed: Socket.IO hanya
  // di-attach bila diaktifkan eksplisit ("true"). Nilai lain -> false.
  REALTIME_ENABLED: strictEnvBoolean(false),
  /// Adapter provider PPOB (Stage R2.7/R2.8). Default "disabled": setiap
  /// pembelian dibatalkan dengan refund penuh dan 503 PPOB_PROVIDER_DISABLED.
  /// "stub" menyalakan adapter sintetis deterministik untuk UAT. "digiflazz"
  /// (Stage R2.8) menyalakan provider nyata — WAJIB disertai kredensial di
  /// bawah, kalau tidak resolusi provider melempar saat boot route dipakai.
  /// Nilai tak dikenal menggagalkan boot, bukan jatuh ke perilaku tak terduga.
  PPOB_PROVIDER: z.enum(["disabled", "stub", "digiflazz"]).default("disabled"),
  /// Kredensial Digiflazz (Stage R2.8). Backend-only — JANGAN pernah dikirim
  /// ke klien mana pun; sign dihitung di server.
  DIGIFLAZZ_USERNAME: z.string().optional(),
  DIGIFLAZZ_API_KEY: z.string().optional(),
  /// Override base URL untuk stub server pada integration test. Default
  /// https://api.digiflazz.com/v1.
  DIGIFLAZZ_BASE_URL: z.string().url().optional(),
  /// Paksa mode testing Digiflazz (testing=true). Di luar production mode
  /// testing SELALU aktif apa pun nilainya — saldo seller nyata tidak pernah
  /// tersentuh oleh UAT.
  DIGIFLAZZ_TESTING: strictEnvBoolean(false),
  /// Secret webhook Digiflazz (X-Hub-Signature = HMAC-SHA1 raw body).
  /// SENGAJA terpisah dari API key: keduanya dikonfigurasi di tempat berbeda
  /// pada panel Digiflazz. Endpoint webhook fail-closed (503) bila kosong.
  DIGIFLAZZ_WEBHOOK_SECRET: z.string().min(16).optional(),
  /// Worker rekonsiliasi PPOB (Stage R2.8). Fail-closed default mati; hanya
  /// bermakna saat provider mendukung cek status (digiflazz).
  PPOB_RECONCILE_ENABLED: strictEnvBoolean(false),
  PPOB_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(15000).default(60000),
  DOKU_CLIENT_ID: z.string().optional(),
  DOKU_SECRET_KEY: z.string().optional(),
  DOKU_API_KEY: z.string().optional(),
  DOKU_PUBLIC_KEY: z.string().optional(),
  DOKU_MERCHANT_PUBLIC_KEY: z.string().optional(),
  /// Lihat catatan pada MIDTRANS_IS_PRODUCTION: DOKU_ENABLED=false dengan
  /// z.coerce.boolean() justru MENYALAKAN DOKU.
  DOKU_ENABLED: strictEnvBoolean(false),
  DOKU_INTEGRATION_MODE: z
    .enum(["checkout", "snap_direct"])
    .default("checkout"),
  DOKU_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  DOKU_BASE_URL: z.string().url().optional(),
  DOKU_WEBHOOK_SECRET: z.string().optional(),
  DOKU_WEBHOOK_URL: z.string().url().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Identifier blind index (HMAC-SHA256). Backend-only, terpisah dari secret
  // JWT/payment/storage. Sengaja optional pada schema: kegagalan bersifat
  // fail-closed saat registry dibangun (lihat identifierKeyRegistry.ts), bukan
  // saat proses boot untuk kebutuhan lain. Maksimal dua versi aktif (D-06).
  IDENTIFIER_INDEX_KEY_CURRENT_VERSION: z.coerce.number().int().positive().optional(),
  IDENTIFIER_INDEX_KEY_V1: z.string().min(32).optional(),
  IDENTIFIER_INDEX_KEY_V2: z.string().min(32).optional(),
});

const rawEnv = {
  ...process.env,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET,
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN,
};

export const env = envSchema.parse(rawEnv);

export const corsOrigins = env.CORS_ORIGINS.split(",").map((origin) =>
  origin.trim(),
);

const unsafeProductionCorsOrigins = corsOrigins.filter((origin) => {
  if (origin === "*") return true;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return true;
  }
});

if (env.NODE_ENV === "production" && unsafeProductionCorsOrigins.length > 0) {
  throw new Error(
    `Unsafe CORS_ORIGINS for production: ${unsafeProductionCorsOrigins.join(", ")}`
  );
}
