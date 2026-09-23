# Sentry untuk driver_app & user_app

**Status: SUDAH diterapkan** ke `pubspec.yaml`/`main.dart` kedua app
(2026-09-23, setelah Owner mendaftar di sentry.io). Kode di bawah bukan lagi
sekadar contoh — ini menjelaskan integrasi yang sudah ada di repo.

Yang masih perlu Owner lakukan: buat DUA project Sentry terpisah di
[sentry.io](https://sentry.io) (org `xavindo-1i`), platform **Flutter** —
`tapgo-driver-app` dan `tapgo-user-app`. driver_app dan user_app adalah
aplikasi berbeda, JANGAN berbagi satu DSN. Tanpa DSN diisi saat build,
Sentry tetap tidak aktif sama sekali (fail-closed) — app berjalan normal,
hanya belum melaporkan apa pun.

Backend Node.js SUDAH terintegrasi sungguhan juga — lihat
`apps/backend/src/core/monitoring/sentry.ts`, `SENTRY_DSN` di
`.env.production.example`.

## Catatan implementasi (untuk siapa pun yang menyentuh kode ini nanti)

- `kSentryDsn` didefinisikan di `apps/driver_app/lib/core/config/app_config.dart`
  dan `apps/user_app/lib/main.dart` — `String.fromEnvironment('SENTRY_DSN')`,
  kosong secara default.
- `main()` di kedua app membungkus `runApp(...)` yang sudah ada (kini
  diekstrak jadi `_runTapGoDriverApp()`/`_runTapGoUserApp()`) dengan
  `SentryFlutter.init(...)` HANYA bila `kSentryDsn` terisi.
- `lib/tapgo_app_guards.dart` (file yang sama, di-symlink dari
  `driver_app` ke `user_app` — hanya SATU salinan sungguhan, di user_app)
  memanggil `Sentry.captureException` di dalam `FlutterError.onError` dan
  `PlatformDispatcher.instance.onError` yang SUDAH ADA sebelumnya — bukan
  mekanisme fallback baru.
- Dua titik tangkap transaksi-kritis (sudah punya try/catch sendiri, jadi
  TIDAK pernah sampai ke handler global di atas) ditambahi
  `Sentry.captureException` eksplisit: `ppob_checkout_screen.dart`'s
  `_pay()`, dan `ride_customer_screens.dart`'s `_guarded()`. Sesi
  kedaluwarsa (401) SENGAJA tidak di-capture di sana — itu bukan bug,
  sudah punya alur pemulihan sendiri.
- `Sentry.setUser` (identifikasi akun tanpa PII) **belum** dipasang — model
  sesi klien (`DriverSession` dkk) tidak menyimpan ID stabil di sisi
  Flutter saat ini (hanya token + nama). Menambahkannya butuh decode JWT
  atau perubahan API, di luar cakupan permintaan "aktifkan monitoring" —
  catatan untuk pekerjaan lanjutan bila dibutuhkan.
- `options.sendDefaultPii = false` diset eksplisit di kedua app.

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

## 4. ErrorBoundary / fallback UI — SUDAH ADA, tidak perlu dibuat lagi

Kedua app **sudah punya** mekanisme ini, independen dari Sentry — lihat
`lib/tapgo_app_guards.dart` di masing-masing app (`installTapGoCrashGuards()`,
dipanggil di baris pertama `main()`):
- `FlutterError.onError` diganti di build produksi supaya error saat
  membangun widget menampilkan `_CrashFallbackScreen` (pesan netral,
  "Terjadi gangguan tampilan. Tutup lalu buka kembali aplikasi.") alih-alih
  layar merah bawaan Flutter.
- `PlatformDispatcher.instance.onError` menangkap error asinkron di luar
  tangkapan framework, supaya jejaknya tetap ada (di debug) tanpa membocorkan
  detail ke log perangkat pengguna nyata di production.

Begitu Sentry benar-benar diaktifkan (langkah 3 di atas), tinggal tambahkan
`Sentry.captureException` di DALAM kedua handler yang sudah ada ini — bukan
membuat mekanisme fallback baru:

```dart
// lib/tapgo_app_guards.dart — tambahan setelah SentryFlutter.init aktif
FlutterError.onError = (details) {
  FlutterError.presentError(details);
  if (kSentryDsn.isNotEmpty) {
    Sentry.captureException(details.exception, stackTrace: details.stack);
  }
  if (kDebugMode) return;
  ErrorWidget.builder = (FlutterErrorDetails details) => const _CrashFallbackScreen();
};

PlatformDispatcher.instance.onError = (error, stack) {
  if (kSentryDsn.isNotEmpty) {
    Sentry.captureException(error, stackTrace: stack);
  }
  if (kDebugMode) {
    debugPrint('[TapGo Crash] ${error.runtimeType}: $error\n$stack');
  }
  return true;
};
```

## 5. Identifikasi akun tanpa data sensitif (`Sentry.setUser`)

Supaya crash bisa ditelusuri ke akun yang mengalaminya TANPA mengirim PII
(nama, telepon, NIK) ke Sentry — hanya ID internal + role:

```dart
// driver_app — dipanggil setelah login berhasil (mis. di driver_controller.dart
// begitu DriverSession didapat), dan DIHAPUS lagi saat logout.
if (kSentryDsn.isNotEmpty) {
  Sentry.configureScope((scope) {
    scope.setUser(SentryUser(id: session.driverId, data: {'role': 'driver'}));
  });
}

// Saat logout — jangan biarkan sesi berikutnya (mis. akun lain di perangkat
// yang sama, atau demo login) ikut membawa identitas akun sebelumnya.
if (kSentryDsn.isNotEmpty) {
  Sentry.configureScope((scope) => scope.setUser(null));
}
```

`user_app` memakai pola yang sama dengan `userId`/`role: 'user'` — cek
`session.userId` yang sudah ada di sesi login (`_TapGoPersistentStore`).

## 6. Kegagalan transaksi PPOB / checkout trip Ojol

Dua titik tangkap yang SUDAH ADA di `user_app` dan cocok ditambahi
`Sentry.captureException` — bukan mengganti alur error yang sudah berjalan,
hanya MENAMBAH pelaporan di sampingnya:

**PPOB** — `lib/features/ppob/presentation/ppob_checkout_screen.dart`, method
`_pay()` (sekitar baris 122–147), sudah membungkus `createOrder(...)` dengan
try/catch:

```dart
} catch (error, stackTrace) {
  if (!mounted) return;
  if (kSentryDsn.isNotEmpty) {
    Sentry.captureException(
      error,
      stackTrace: stackTrace,
      withScope: (scope) {
        scope.setContexts('ppob_order', {
          'sku': widget.product.sku,
          // JANGAN sertakan targetNumber mentah (nomor tujuan pelanggan) —
          // itu identifier pribadi, sama alasannya dengan redaksi "phone" di
          // logger backend.
        });
      },
    );
  }
  setState(() {
    _result = null;
    _errorMessage = ppobErrorMessage(error);
  });
}
```

**Trip Ojol** — `lib/screens/ride_customer_screens.dart`, method `_guarded()`
(sekitar baris 523+), pembungkus bersama untuk seluruh aksi ride (booking,
cancel, dll) di layar itu:

```dart
} catch (error, stackTrace) {
  if (!mounted) return;
  if (kSentryDsn.isNotEmpty && !tapGoRideIsSessionExpired(error)) {
    // Sesi kedaluwarsa BUKAN bug — jangan penuhi Sentry dengan noise untuk
    // sesuatu yang sudah punya penanganan pemulihan sendiri di bawah.
    Sentry.captureException(
      error,
      stackTrace: stackTrace,
      withScope: (scope) => scope.setContexts('ride_action', {
        'service': _service.name,
      }),
    );
  }
  // ... penanganan tapGoRideIsSessionExpired dkk yang sudah ada tetap jalan
  // persis seperti sekarang, tidak diubah.
}
```

## 7. Catatan privasi

Sentry SDK Flutter secara default mengirim breadcrumb navigasi & device info.
**Jangan** aktifkan `options.sendDefaultPii = true` di app ini — data pribadi
pengguna (NIK, nomor telepon, dsb.) tidak boleh terkirim ke Sentry sama
sekali, konsisten dengan redaksi ketat yang sudah diterapkan di logger
backend (`core/logger/logger.ts`).
