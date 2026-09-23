# Sentry untuk driver_app & user_app (panduan + snippet)

Dokumentasi ini **belum diterapkan** ke `pubspec.yaml`/`main.dart` kedua app —
sesuai permintaan Owner ("panduan dan snippet"), bukan integrasi langsung.
Alasan: menambah dependency + inisialisasi Sentry ke app produksi butuh DSN
sungguhan per app (dua project Sentry terpisah — driver_app dan user_app
adalah aplikasi berbeda, jangan berbagi satu DSN) dan menambah ukuran
binary, keduanya keputusan yang lebih baik dikonfirmasi Owner dulu sebelum
diterapkan ke app yang sudah berjalan di produksi.

Backend Node.js SUDAH terintegrasi sungguhan (bukan cuma panduan) — lihat
`apps/backend/src/core/monitoring/sentry.ts`, `SENTRY_DSN` di
`.env.production.example`.

## 1. Buat project Sentry

Di [sentry.io](https://sentry.io) (atau instance self-hosted Anda), buat DUA
project terpisah, platform **Flutter**:
- `tapgo-driver-app`
- `tapgo-user-app`

Masing-masing punya DSN sendiri (`https://xxxxx@oXXXXXX.ingest.sentry.io/XXXXXXX`).

## 2. Tambah dependency

Di `pubspec.yaml` masing-masing app:

```yaml
dependencies:
  sentry_flutter: ^8.9.0 # cek versi terbaru di pub.dev sebelum menerapkan
```

## 3. Inisialisasi di `main()`

Pola yang sudah dipakai di kedua app untuk konfigurasi opsional/fail-closed
(mis. `kGoogleServerClientId`, `kDriverDemoMode` di driver_app) — DSN kosong
= Sentry tidak aktif, sama seperti pola `SENTRY_DSN` kosong di backend:

```dart
import 'package:sentry_flutter/sentry_flutter.dart';

// Sama pola dengan kGoogleServerClientId dkk di core/config/app_config.dart —
// kosong = tidak aktif, tidak perlu cabang if terpisah di seluruh app.
const String kSentryDsn = String.fromEnvironment('SENTRY_DSN', defaultValue: '');

Future<void> main() async {
  if (kSentryDsn.isEmpty) {
    // Sama seperti sebelumnya — tidak ada Sentry sama sekali. Jangan
    // panggil SentryFlutter.init() dengan DSN kosong (SDK akan warning).
    installTapGoCrashGuards(); // fungsi guard yang sudah ada di driver_app
    runApp(const ProviderScope(child: TapGoDriverApp()));
    return;
  }

  await SentryFlutter.init(
    (options) {
      options.dsn = kSentryDsn;
      options.environment = const String.fromEnvironment(
        'TAPGO_ENV',
        defaultValue: 'production',
      );
      // 10%: sama seperti tracesSampleRate backend — cukup untuk gambaran
      // performa tanpa membebani kuota Sentry.
      options.tracesSampleRate = 0.1;
    },
    appRunner: () {
      installTapGoCrashGuards();
      runApp(const ProviderScope(child: TapGoDriverApp()));
    },
  );
}
```

Build dengan DSN:

```bash
flutter build apk --dart-define=SENTRY_DSN=https://xxxxx@oXXXXXX.ingest.sentry.io/XXXXXXX
```

## 4. Menangkap error yang sudah ditangani sendiri (opsional)

Untuk error yang di-`catch` tapi tetap ingin terlihat di Sentry (bukan cuma
crash tak tertangani):

```dart
try {
  await someRiskyOperation();
} catch (error, stackTrace) {
  if (kSentryDsn.isNotEmpty) {
    await Sentry.captureException(error, stackTrace: stackTrace);
  }
  // ... penanganan lokal yang sudah ada tetap jalan seperti biasa.
}
```

## 5. Catatan privasi

Sentry SDK Flutter secara default mengirim breadcrumb navigasi & device info.
**Jangan** aktifkan `options.sendDefaultPii = true` di app ini — data pribadi
pengguna (NIK, nomor telepon, dsb.) tidak boleh terkirim ke Sentry sama
sekali, konsisten dengan redaksi ketat yang sudah diterapkan di logger
backend (`core/logger/logger.ts`).
