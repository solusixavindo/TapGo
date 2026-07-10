# Flutter Startup Splash Hang Fix Report

Tanggal: 2026-06-18

## Executive Summary

Bug Closed Testing yang hanya berhenti di logo/splash kemungkinan besar disebabkan oleh proses startup yang menjalankan secure storage cleanup sebelum `runApp()` tanpa timeout/fail-open.

Patch minimal-risk sudah diterapkan agar aplikasi selalu lanjut ke login/dashboard walaupun:

- `SharedPreferences` gagal/lambat
- `FlutterSecureStorage.deleteAll()` gagal/lambat
- session restore gagal
- token lama expired/rusak
- device fingerprint secure storage gagal/lambat

Tidak ada perubahan business flow.

## Root Cause

Root cause paling mungkin:

```text
main()
→ _prepareProductionFinalSync()
→ clearProductionRuntimeCache()
→ FlutterSecureStorage.deleteAll()
```

Sebelumnya proses ini berjalan sebelum `runApp()`. Jika secure storage bermasalah di HP real, `runApp()` bisa tertahan sehingga user hanya melihat logo/splash.

Risk tambahan:

- `_SessionBootstrap._restore()` belum punya top-level `try/finally`, sehingga error bootstrap tertentu bisa membuat loading tidak selesai.
- Dio interceptor device fingerprint menunggu secure storage tanpa fail-open, sehingga request auth restore/login/register bisa tertahan jika secure storage bermasalah.

## File yang Diubah

1. `apps/user_app/lib/main.dart`
2. `apps/user_app/lib/services/persistent_demo_store.dart`
3. `apps/user_app/lib/services/tapgo_api_client.dart`

## Patch yang Dibuat

### 1. Startup `main()` dibuat fail-open

File:

- `apps/user_app/lib/main.dart`

Perubahan:

- Startup init dibungkus `try/catch`.
- `_prepareProductionFinalSync()` diberi timeout 3 detik.
- Non-production server config load diberi timeout 2 detik.
- Jika error terjadi, app tetap memanggil `runApp()`.
- Production tetap dipaksa ke `https://api.tapgolion.id`.

Dampak:

- Error storage/config tidak bisa lagi mencegah Flutter UI tampil.

### 2. Production cache reset diberi timeout dan catch per step

File:

- `apps/user_app/lib/main.dart`

Perubahan:

- `resetApiBaseUrl()` timeout 1 detik.
- `clearProductionRuntimeCache()` timeout 2 detik.
- `setBool(resetKey)` timeout 1 detik.
- Semua error hanya `debugPrint`, lalu lanjut.

Dampak:

- Secure storage cleanup tidak lagi menjadi blocker startup.

### 3. Session bootstrap selalu selesai

File:

- `apps/user_app/lib/services/persistent_demo_store.dart`

Perubahan:

- `_SessionBootstrap._restore()` dibungkus `try/catch/finally`.
- Semua restore penting diberi timeout.
- Jika token/profile restore gagal:
  - session dibersihkan sebisanya
  - access token dihapus dari API client
  - auth state diarahkan ke `false`
  - app lanjut ke login
- `setState(() => _loaded = true)` dipindah ke `finally`.

Dampak:

- Bootstrap tidak bisa stuck loading karena token/session rusak.

### 4. Dio device fingerprint interceptor fail-open

File:

- `apps/user_app/lib/services/tapgo_api_client.dart`

Perubahan:

- Interceptor device fingerprint diberi timeout 1 detik.
- Jika fingerprint gagal:
  - request tetap dikirim
  - hanya header aman `X-TapGo-App-Version` dan `X-TapGo-Platform` yang dikirim

Dampak:

- Anti-abuse metadata tidak boleh mengorbankan login/register/API request.

### 5. Device fingerprint storage diberi timeout/catch

File:

- `apps/user_app/lib/services/tapgo_api_client.dart`

Perubahan:

- Secure storage read timeout 700ms.
- Secure storage write timeout 700ms.
- Read/write error ditangkap dan tidak dilempar.
- Ada `_memoryCache` sebagai fallback selama session app.
- Register body memakai fallback context jika device context timeout.

Dampak:

- Secure storage error tidak memblokir device fingerprint maupun register/login.

## Validasi

### dart format

Status: **PASS**

Command:

```bash
dart format apps/user_app/lib/main.dart apps/user_app/lib/services/persistent_demo_store.dart apps/user_app/lib/services/tapgo_api_client.dart
```

Hasil:

```text
Formatted 3 files
```

### flutter analyze

Status: **PASS**

Command:

```bash
flutter analyze
```

Hasil:

```text
No issues found!
```

Catatan warning dari Flutter:

- beberapa plugin belum support Swift Package Manager untuk iOS/macOS. Ini warning tooling, bukan error startup Android.

### flutter test

Status: **PASS**

Command:

```bash
flutter test
```

Hasil:

```text
All tests passed!
7 tests passed
```

### flutter run

Status: **NOT RUN**

Alasan:

- Tidak ada Android device/emulator terdeteksi.
- `flutter devices` hanya menemukan:
  - macOS desktop
  - Chrome web

Karena bug terjadi di Closed Testing Android, `flutter run` ke macOS/Chrome tidak dijalankan agar tidak memberi validasi yang menyesatkan.

## Apakah Perlu AAB versionCode 3?

Ya.

Karena AAB versi 2 sudah masuk Google Play Closed Testing, setiap upload update ke track yang sama harus memakai `versionCode` lebih tinggi.

Rekomendasi saat nanti build AAB:

- naikkan `versionCode` ke 3
- naikkan `versionName` jika diperlukan, misalnya `1.0.2`
- build AAB release hanya setelah owner approve

Tahap ini **belum build AAB/APK release**.

## Manual QA yang Disarankan

Setelah AAB debug/internal siap nanti:

1. Install fresh.
2. Clear app data.
3. Buka app.
4. Pastikan splash maksimal beberapa detik lalu masuk login.
5. Login user valid.
6. Logout.
7. Relaunch.
8. Simulasikan token expired/lama.
9. Matikan internet dan buka app.
10. Pastikan tidak stuck di logo.

## Konfirmasi Batasan

Tahap ini:

- Tidak deploy.
- Tidak build release APK/AAB.
- Tidak migration.
- Tidak cleanup execute.
- Tidak production DB change.
- Tidak mengubah business flow utama.
