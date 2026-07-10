# AAB V3 Pre-Upload Safety Audit

Tanggal audit: 2026-06-18  
Artifact diaudit: `apps/user_app/build/app/outputs/bundle/release/app-release.aab`  
Target upload: Google Play Closed Testing Alpha  
Keputusan: **CONDITIONAL GO / AMAN DIUPLOAD DENGAN CATATAN WARNING**

## Executive Summary

AAB v3 sudah memenuhi metadata utama untuk Closed Testing:

- Package name: **PASS** `id.tapgolion.tapgo`
- Version name/code: **PASS** `1.0.2` / `3`
- Release signing: **PASS** `jar verified`
- Min/target SDK: **PASS** minSdk `24`, targetSdk `36`
- Production API: **PASS** `https://api.tapgolion.id`
- Startup splash hang patch: **PASS** fail-open sudah terpasang
- Flutter analyze/test: **PASS**

Catatan utama sebelum upload:

1. `debugPrint` response auth/wallet masih ada di source. Ini tidak tampil ke user, tetapi sebaiknya dibersihkan setelah Closed Testing atau sebelum public production.
2. Artifact berisi string `localhost/127.0.0.1` dari konteks Flutter/framework, bukan sebagai base URL aplikasi. Tidak ditemukan `trycloudflare`, `ngrok`, `10.0.2.2`, atau secret Midtrans di mobile artifact.
3. Mode build production tidak dapat dibuktikan 100% dari AAB tanpa build log. Source mendukung production melalui `--dart-define=TAPGO_APP_MODE=production`; pastikan command build yang dipakai untuk artifact ini memang memakai dart-define production.

## 1. AAB Artifact Audit

| Item | Status | Hasil |
|---|---:|---|
| File AAB tersedia | PASS | `apps/user_app/build/app/outputs/bundle/release/app-release.aab` |
| Size | PASS | `55,055,739 bytes` atau sekitar 53 MB |
| Package name | PASS | `id.tapgolion.tapgo` dari merged release manifest |
| versionName | PASS | `1.0.2` |
| versionCode | PASS | `3` |
| minSdk | PASS | `24` |
| targetSdk | PASS | `36` |
| Release signed | PASS | `jarsigner`: `jar verified` |
| Debug signed fallback | PASS | `build.gradle.kts` mewajibkan `key.properties`; release build gagal jika release signing tidak tersedia |

Sumber verifikasi:

- `apps/user_app/build/app/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`
- `apps/user_app/pubspec.yaml`
- `apps/user_app/android/app/build.gradle.kts`
- `apps/user_app/build/app/outputs/bundle/release/app-release.aab`

Catatan signing:

- `jarsigner` memberi warning self-signed/timestamp. Ini normal untuk upload key lokal sebelum Google Play App Signing mendistribusikan final signing certificate.
- `apps/user_app/android/key.properties` dan `apps/user_app/android/keystore/tapgo-upload-keystore.jks` terdeteksi tersedia lokal. Jangan commit atau membagikan file ini.

## 2. Permission Audit

Release manifest meminta permission berikut:

| Permission | Status | Catatan Data Safety |
|---|---:|---|
| `android.permission.INTERNET` | PASS | Dibutuhkan untuk API TapGo, Midtrans redirect, dan data backend |
| `android.permission.ACCESS_NETWORK_STATE` | PASS | Dibutuhkan untuk deteksi konektivitas |
| `android.permission.CAMERA` | WARNING | Harus dijelaskan di Data Safety jika fitur KTP/selfie/upload dokumen masih dipakai |
| `android.permission.READ_MEDIA_IMAGES` | WARNING | Untuk Android 13+, harus dijelaskan sebagai akses media gambar jika upload gambar/dokumen dipakai |
| `android.permission.READ_EXTERNAL_STORAGE` maxSdk 32 | WARNING | Legacy permission untuk Android 12 ke bawah; perlu disclosure Data Safety |
| `android.permission.POST_NOTIFICATIONS` | WARNING | Perlu deklarasi notifikasi di Play Console jika FCM/notifikasi digunakan |
| `com.google.android.c2dm.permission.RECEIVE` | PASS | Terkait Firebase Messaging |

Kesimpulan permission:

- Tidak ada permission yang langsung menjadi blocker untuk Closed Testing.
- Google Play Data Safety harus menyatakan penggunaan kamera/media untuk upload dokumen/profil/KYC jika fitur tersebut tersedia.
- Jika fitur kamera/media belum aktif untuk user, pertimbangkan penghapusan permission pada rilis berikutnya agar disclosure lebih ringan.

## 3. Startup Splash Hang Fix Audit

| Area | Status | Temuan |
|---|---:|---|
| `main()` fail-open | PASS | `runApp()` tetap dipanggil setelah `try/catch`; production reset diberi timeout |
| Production cache reset | PASS | `_prepareProductionFinalSync()` memberi timeout dan catch pada reset server config, secure cache, dan marker |
| `FlutterSecureStorage.deleteAll()` | PASS dengan catatan | Dipanggil melalui `clearProductionRuntimeCache().timeout(...)` dari `main.dart`; tidak lagi bisa menahan startup tanpa batas |
| Session restore | PASS | `_SessionBootstrap._restore()` memakai `try/catch/finally`; `_loaded = true` selalu diset |
| Token/profile restore failure | PASS | Failure diarahkan ke unauthenticated/login, bukan stuck |
| Dio device fingerprint interceptor | PASS | Device context load timeout 1 detik; error memakai fallback headers dan request tetap jalan |
| Device fingerprint storage read/write | PASS | Secure storage read/write diberi timeout/catch dan memory fallback |

Catatan teknis:

- `clearProductionRuntimeCache()` secara internal masih memanggil `_storage.deleteAll()` tanpa timeout, tetapi saat ini hanya dipanggil dari `main.dart` dengan timeout 2 detik. Jika di masa depan method ini dipakai dari tempat lain, panggilan tersebut juga harus diberi timeout.

## 4. Production Config Audit

| Item | Status | Hasil |
|---|---:|---|
| Production API di source | PASS | Default `_tapGoApiBaseUrl` adalah `https://api.tapgolion.id/api/v1` |
| Production API di artifact | PASS | `api.tapgolion.id` ditemukan di `libapp.so` |
| `localhost` sebagai app base URL | PASS dengan catatan | String `localhost` terdeteksi di artifact, tetapi konteksnya framework/Flutter symbol, bukan `http://localhost` base URL aplikasi |
| `127.0.0.1` | PASS dengan catatan | Terdeteksi di `libflutter.so` bawaan, bukan konfigurasi TapGo |
| `10.0.2.2` | PASS | Tidak ditemukan |
| `trycloudflare` | PASS | Tidak ditemukan |
| `ngrok` | PASS | Tidak ditemukan |
| Midtrans server/client key di mobile | PASS | Tidak ditemukan `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `server_key`, atau `client_key` |
| Debug banner | PASS | `debugShowCheckedModeBanner: false` |
| Production mode dart-define | WARNING | Tidak bisa dibuktikan langsung dari AAB tanpa build log. Pastikan artifact dibuat dengan `--dart-define=TAPGO_APP_MODE=production --dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id` |

## 5. Logging / Sensitive Output Audit

Status: **WARNING**

Masih ditemukan `debugPrint` yang mencetak response body auth/wallet/API di:

- `apps/user_app/lib/services/tapgo_api_client.dart`
- `apps/user_app/lib/screens/auth_screen.dart`
- beberapa flow admin/binding diagnostic

Risiko:

- Tidak tampil ke UI user.
- Namun logcat pada device debug/rooted/test environment dapat memuat response API.
- Password sudah dimasking pada payload login/register, tetapi response auth berpotensi mengandung token/user data tergantung backend response.

Rekomendasi:

- Tidak wajib memblokir upload Closed Testing.
- Sebelum public production, bungkus logging sensitif dengan `kDebugMode` atau hapus response body logging.

## 6. Validation Result

| Command | Status | Ringkasan |
|---|---:|---|
| `flutter analyze` | PASS | `No issues found!` |
| `flutter test` | PASS | `7 tests passed` |
| `flutter build appbundle --release` | NOT RUN | Tidak dijalankan ulang agar artifact AAB yang sudah dibuat tidak terganti sebelum upload |

Catatan Flutter:

- Flutter memberi warning bahwa beberapa plugin iOS/macOS belum mendukung Swift Package Manager. Ini tidak memblokir Android AAB.

## 7. PASS / WARNING / FAIL Summary

| Area | Status |
|---|---:|
| AAB metadata package/version | PASS |
| Release signing | PASS |
| SDK compatibility | PASS |
| Artifact size | PASS |
| Startup fail-open patch | PASS |
| Secure storage timeout/catch | PASS |
| Device fingerprint fail-open | PASS |
| Production API target | PASS |
| Forbidden tunnel/local URLs | PASS dengan catatan framework strings |
| Mobile secret keys | PASS |
| Permission/Data Safety | WARNING |
| Sensitive debugPrint | WARNING |
| Production dart-define proof from artifact | WARNING |
| Analyze/test | PASS |

## 8. Upload Recommendation

Rekomendasi: **AMAN DIUPLOAD KE CLOSED TESTING ALPHA dengan catatan berikut:**

1. Pastikan file yang diupload adalah:
   `apps/user_app/build/app/outputs/bundle/release/app-release.aab`
2. Pastikan build command untuk artifact ini sebelumnya adalah production:
   ```bash
   flutter build appbundle --release \
     --dart-define=TAPGO_APP_MODE=production \
     --dart-define=TAPGO_API_BASE_URL=https://api.tapgolion.id
   ```
3. Pastikan Google Play Data Safety menyebut kamera/media/storage/notifikasi sesuai fitur yang aktif.
4. Jadwalkan cleanup `debugPrint` sensitif sebelum public launch.

## 9. Risiko Tersisa

| Risiko | Level | Mitigasi |
|---|---:|---|
| Midtrans payment channel masih menunggu aktivasi | P1 | Closed Testing bisa lanjut; public launch tetap menunggu Midtrans aktif |
| `debugPrint` response auth/wallet masih ada | P2/P1 sebelum public | Hapus/gate dengan `kDebugMode` sebelum public production |
| CAMERA/media/storage perlu Data Safety tepat | P1 compliance | Isi Data Safety sesuai permission dan fitur upload dokumen/profil |
| Mode production artifact perlu bukti build log | P2 | Simpan command build final atau rebuild final hanya jika diminta owner |

## 10. Confirmation

- Tidak deploy VPS.
- Tidak build ulang AAB/APK.
- Tidak menjalankan migration.
- Tidak menjalankan cleanup.
- Tidak menyentuh production database.
- Tidak upload ke Google Play dari Codex.

