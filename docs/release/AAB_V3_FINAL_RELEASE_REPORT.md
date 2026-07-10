# AAB V3 Final Release Report

Tanggal build: 2026-06-18  
Target: Google Play Closed Testing Alpha  
Package: `id.tapgolion.tapgo`  
Version: `1.0.2+3`

## Executive Summary

AAB final v3 berhasil dibuat dan disalin ke folder release Google Play.

Keputusan: **GO / DIREKOMENDASIKAN UPLOAD KE GOOGLE PLAY CLOSED TESTING ALPHA**

Catatan:

- Build dilakukan dengan mode production:
  `--dart-define=TAPGO_APP_MODE=production`
- API production diarahkan ke:
  `https://api.tapgolion.id`
- Patch splash fail-open ikut masuk ke build final.
- Tidak ada deploy backend.
- Tidak ada migration.
- Tidak ada cleanup.
- Tidak ada perubahan production database.

## 1. File AAB Final

Artifact hasil build:

```text
apps/user_app/build/app/outputs/bundle/release/app-release.aab
```

Salinan final untuk upload:

```text
google-play-assets/releases/tapgo-user-v1.0.2-3-release.aab
```

Ukuran:

```text
54,990,913 bytes
```

SHA-256:

```text
8e1f3c32bc3d02298748eb3ee4a29cbad196da8ea84a3291e961a93658960a10
```

Checksum artifact build dan salinan final sama.

## 2. Version & Package Validation

Sumber:

- `apps/user_app/pubspec.yaml`
- `apps/user_app/android/app/build.gradle.kts`
- `apps/user_app/build/app/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`

| Item | Expected | Actual | Status |
|---|---:|---:|---:|
| packageName / applicationId | `id.tapgolion.tapgo` | `id.tapgolion.tapgo` | PASS |
| namespace | `id.tapgolion.tapgo` | `id.tapgolion.tapgo` | PASS |
| versionName | `1.0.2` | `1.0.2` | PASS |
| versionCode | `3` | `3` | PASS |
| minSdk | valid | `24` | PASS |
| targetSdk | valid | `36` | PASS |

## 3. Release Signing

| Item | Status | Catatan |
|---|---:|---|
| `key.properties` terbaca | PASS | File tersedia lokal |
| keystore terbaca | PASS | File tersedia lokal |
| release signing aktif | PASS | `build.gradle.kts` memakai `signingConfigs.getByName("release")` |
| debug fallback dimatikan | PASS | Release build akan gagal jika `key.properties` tidak ada |
| AAB verified | PASS | `jarsigner`: `jar verified` |

Catatan `jarsigner`:

- Warning self-signed certificate/timestamp muncul karena upload key lokal. Ini normal untuk proses Google Play App Signing.
- Tidak ada indikasi debug signing.

## 4. Build Commands

Validasi source:

```bash
flutter analyze
flutter test
```

Build final:

```bash
flutter clean
flutter pub get
flutter build appbundle --release \
  --dart-define=TAPGO_APP_MODE=production \
  --dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id
```

Build output:

```text
✓ Built build/app/outputs/bundle/release/app-release.aab (55.0MB)
```

## 5. Analyze / Test / Build Result

| Command | Result | Detail |
|---|---:|---|
| `flutter analyze` | PASS | `No issues found!` |
| `flutter test` | PASS | `7 tests passed` |
| `flutter clean` | PASS | Build output dibersihkan |
| `flutter pub get` | PASS | Dependencies resolved |
| `flutter build appbundle --release ...` | PASS | AAB release berhasil dibuat |

Warnings non-blocking:

- Beberapa plugin iOS/macOS belum mendukung Swift Package Manager. Tidak memblokir Android AAB.
- Beberapa plugin Android masih memakai Kotlin Gradle Plugin lama. Tidak memblokir build saat ini, tetapi perlu dipantau untuk upgrade Flutter berikutnya.
- Java source/target 8 warning dari Gradle. Tidak memblokir build saat ini.

## 6. Endpoint & Secret Audit

Scan artifact AAB:

| Check | Result | Catatan |
|---|---:|---|
| `https://api.tapgolion.id` | PASS | Ditemukan di `libapp.so` |
| `http://localhost` / `https://localhost` | PASS | Tidak ditemukan |
| `http://127.0.0.1` / `https://127.0.0.1` | PASS | Tidak ditemukan |
| `10.0.2.2` | PASS | Tidak ditemukan |
| `trycloudflare` | PASS | Tidak ditemukan |
| `ngrok` | PASS | Tidak ditemukan |
| `MIDTRANS_SERVER_KEY` | PASS | Tidak ditemukan |
| `MIDTRANS_CLIENT_KEY` | PASS | Tidak ditemukan |
| `DATABASE_URL` | PASS | Tidak ditemukan sebagai secret aplikasi |
| `JWT_SECRET` | PASS | Tidak ditemukan |
| `POSTGRES_PASSWORD` | PASS | Tidak ditemukan |

Catatan false positive:

- String `127.0.0.1` muncul di `libflutter.so` bawaan Flutter pada konteks crypto/framework, bukan sebagai endpoint aplikasi.
- String `PRIVATE_KEY` muncul di `libflutter.so` bawaan Flutter pada konteks error crypto seperti `PRIVATE_KEY_TOO_LARGE`, bukan private key TapGo.

## 7. Permission Audit

Release manifest memuat permission berikut:

| Permission | Status | Data Safety Note |
|---|---:|---|
| `INTERNET` | PASS | Wajib untuk API TapGo dan Midtrans |
| `ACCESS_NETWORK_STATE` | PASS | Untuk deteksi koneksi |
| `CAMERA` | WARNING | Perlu disclosure jika dipakai untuk foto dokumen/selfie/profil |
| `READ_MEDIA_IMAGES` | WARNING | Perlu disclosure akses media gambar Android 13+ |
| `READ_EXTERNAL_STORAGE` maxSdk 32 | WARNING | Legacy Android <= 12; perlu disclosure jika upload gambar/dokumen aktif |
| `POST_NOTIFICATIONS` | WARNING | Deklarasikan di Play Console jika notifikasi dipakai |
| `com.google.android.c2dm.permission.RECEIVE` | PASS | Firebase Messaging |

Kesimpulan Data Safety:

- Permission masih sesuai jika aplikasi memakai upload gambar/dokumen/profil dan notifikasi.
- Pastikan Google Play Data Safety menyebut pengumpulan/penggunaan data gambar/media jika fitur tersebut aktif.
- Tidak ada permission yang menjadi blocker untuk Closed Testing.

## 8. Startup Splash Fix Included

Patch fail-open yang masuk build:

- `main()` tetap memanggil `runApp()` walaupun production cache reset gagal.
- `_prepareProductionFinalSync()` diberi timeout dan catch.
- `clearProductionRuntimeCache()` dipanggil dengan timeout dari startup.
- `_SessionBootstrap._restore()` memakai `try/catch/finally`, sehingga loading tidak menggantung.
- Dio interceptor device fingerprint fail-open; request tetap dikirim jika secure storage gagal/timeout.
- Device fingerprint read/write memakai timeout dan fallback non-sensitive.

Status: **PASS**

## 9. Release Notes Google Play

```text
Perbaikan startup aplikasi agar tidak berhenti di logo/splash screen pada beberapa perangkat Android.
Peningkatan stabilitas sesi login, inisialisasi aplikasi, dan koneksi API.
```

## 10. Upload Recommendation

Rekomendasi: **UPLOAD KE GOOGLE PLAY CLOSED TESTING ALPHA**

File yang digunakan:

```text
google-play-assets/releases/tapgo-user-v1.0.2-3-release.aab
```

Checklist sebelum klik upload:

- Pastikan track yang dipilih: Closed Testing Alpha.
- Pastikan versionCode sebelumnya di Play Console lebih rendah dari `3`.
- Gunakan release notes di atas.
- Pastikan Data Safety sudah konsisten dengan permission camera/media/storage/notification.
- Jangan upload file dari path build sementara jika ingin arsip rilis rapi; pakai salinan final di `google-play-assets/releases/`.

## 11. Confirmation

- Tidak deploy backend.
- Tidak menjalankan migration.
- Tidak menjalankan cleanup.
- Tidak menyentuh production database.
- Tidak mengubah business logic.
- Tidak mengubah backend.
- Tidak upload otomatis ke Google Play.

