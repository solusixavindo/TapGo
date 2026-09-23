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
  // Kosong = Sentry tidak aktif sama sekali (fail-closed, lihat
  // core/monitoring/sentry.ts) — TIDAK dibaca dari sini oleh sentry.ts
  // sendiri (dipanggil sebelum env.ts, lihat komentarnya), murni untuk
  // validasi bentuk URL bila memang diisi.
  SENTRY_DSN: z.string().url().optional(),
  // Direktori file log tambahan (error.log, audit.log) di samping stdout —
  // lihat core/logger/logger.ts. Sama seperti SENTRY_DSN, dibaca langsung
  // dari process.env oleh logger.ts (bukan dari sini) karena logger tidak
  // boleh bergantung pada env.ts (lihat komentar di logger.ts) — field ini
  // hanya dokumentasi/referensi skema, bukan sumber nilai yang dipakai.
  LOG_DIR: z.string().optional(),
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
  /// Pencairan saldo lewat dashboard mitra (kanal WEB saja). Terpisah dari
  /// WALLET_CASH_OUT_ENABLED agar rilis Google Play tetap tertutup walau
  /// pencairan web dinyalakan.
  WALLET_CASH_OUT_WEB_ENABLED: strictEnvBoolean(false),
  /// Penarikan dengan nominal sama atau di atas ini hanya boleh disetujui
  /// SUPER_ADMIN_VIP (rupiah penuh). Di bawahnya cukup SUPER_ADMIN.
  WITHDRAWAL_VIP_THRESHOLD: z.coerce.number().int().positive().default(2_000_000),
  /// Transfer P2P TapGoPay antar user (Stage R2.10). Tidak melibatkan payment
  /// gateway eksternal (murni saldo internal), tapi tetap default mati sampai
  /// Owner menyalakannya secara sadar — pola yang sama dengan fitur uang lain
  /// di berkas ini.
  WALLET_TRANSFER_ENABLED: strictEnvBoolean(false),
  /// Top up TapGoPay via Midtrans/DOKU, kanal WEB saja (Stage R2.10) — meniru
  /// MEMBERSHIP_PURCHASE_APP_ENABLED: tetap false untuk aplikasi Play karena
  /// pembayaran eksternal in-app menuntut Play Billing.
  WALLET_TOPUP_ENABLED: strictEnvBoolean(false),
  /// Verifikasi wajah harian driver sebelum online. Default mati: pencocokan
  /// terjadi di HP driver (tidak ada API pihak ketiga), server hanya melacak
  /// hari/percobaan dan menegakkan ambang batas — lihat DriverFaceCheckService.
  DRIVER_FACE_CHECK_ENABLED: strictEnvBoolean(false),
  /// Percobaan verifikasi wajah yang diizinkan per driver per hari sebelum
  /// diblokir dan diarahkan menghubungi admin.
  DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY: z.coerce.number().int().positive().max(10).default(3),
  /// Ambang skor kemiripan (0-1) yang ditegakkan ULANG di server — klien tidak
  /// pernah cukup dipercaya mengirim {passed: true} begitu saja. Disetel ulang
  /// selama rollout berdasarkan similarityScore nyata yang tercatat.
  DRIVER_FACE_CHECK_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.75),
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
  /// Sinkronisasi harga jual PPOB dengan harga modal Digiflazz (keputusan
  /// Owner 20 Sep 2026). Interval minimum 30 menit: daftar harga Digiflazz
  /// dibatasi ketat (rate limit) dan tidak berubah tiap menit.
  PPOB_PRICE_SYNC_ENABLED: strictEnvBoolean(false),
  PPOB_PRICE_SYNC_INTERVAL_MS: z.coerce.number().int().min(1_800_000).default(21_600_000),
  /// Pengiriman OTP lewat email SMTP (keputusan Owner G3, 24 Agustus 2026).
  /// Semua opsional: tanpa SMTP_HOST, provider OTP tetap UnavailableOtpProvider
  /// yang fail-closed. Konfigurasi PARSIAL (host ada tapi kredensial/from
  /// kurang) menggagalkan boot dengan pesan jelas — bukan kegagalan sunyi
  /// pada permintaan OTP pertama.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /// Alamat pengirim, mis. "TapGo <no-reply@tapgolion.id>".
  SMTP_FROM: z.string().optional(),
  /// true = TLS implisit (port 465); false = STARTTLS (port 587).
  SMTP_SECURE: strictEnvBoolean(false),
  /// Daftar/masuk dengan akun Google (driver_app). Ini WAJIB "Web client ID"
  /// dari Google Cloud Console — bukan Android client ID — karena itulah
  /// audience yang tercantum pada ID token yang diverifikasi di sini,
  /// mengikuti dokumentasi resmi Google Identity Services. Tanpa ini,
  /// endpoint /auth/google fail-closed dengan 503, bukan diam-diam menerima
  /// token yang tidak pernah benar-benar diverifikasi.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
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
  /// Sumber estimasi jarak/durasi ride. LOCAL = haversine + faktor jalan
  /// (tanpa jaringan, dipakai default & seluruh test). OSRM = rute jalan
  /// asli lewat instance OSRM self-host — butuh OSRM_BASE_URL. Nilai asing
  /// menggagalkan boot (z.enum), bukan diam-diam jatuh ke LOCAL.
  RIDE_DISTANCE_PROVIDER: z.enum(["LOCAL", "OSRM"]).default("LOCAL"),
  /// Pembayaran perjalanan dengan saldo TapGoPay. Default mati (fail-closed);
  /// pesanan DIGITAL ditolak sampai dinyalakan eksplisit.
  RIDE_DIGITAL_PAYMENT_ENABLED: strictEnvBoolean(false),
  /// Wajib diisi bila RIDE_DISTANCE_PROVIDER=OSRM (lihat resolveDistancePort
  /// di ride.routes.ts) — kosong menggagalkan boot, bukan diam-diam memakai
  /// LOCAL. Contoh lokal: http://localhost:5001
  OSRM_BASE_URL: z.string().url().optional(),
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
