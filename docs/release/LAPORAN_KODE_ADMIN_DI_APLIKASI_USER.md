# Laporan: kode admin di aplikasi user (akar masalah dan pencegahan)

Tanggal: 2026-09-24
Pemicu: seorang admin membagikan tampilan "Founder Program" dari aplikasi Android
TapGo ke status WhatsApp. Owner menetapkan: fungsi admin/Super Admin tidak boleh
ada di APK Play, dan kode yang sudah dinonaktifkan tidak boleh tetap ada.

## 1. Ringkasan

- Layar admin ada di `user_app` sejak commit pertama (2026-07-10) dan, sampai
  2026-09-19, akun admin **diarahkan ke dashboard admin di dalam aplikasi user**
  berdasarkan peran. Setiap build yang terbit sebelum tanggal itu membawa jalur
  akses yang nyata.
- Pada 2026-09-19 jalur itu "disembunyikan", bukan dihapus: 2.785 baris layar
  admin, 25 pemanggilan API `/admin/...`, dan getter `isAdmin`/`isSuperAdmin`
  (dikunci `false`, dengan komentar "dipertahankan agar kode lama tetap
  terkompilasi") tetap berada di repositori.
- Tidak ada satu pun kontrol otomatis yang memeriksa hal ini: `user_app` tidak
  masuk CI sama sekali, dan tidak ada pemeriksaan isi APK sebelum rilis.

## 2. Kronologi (semua berasal dari git dan log produksi)

| Tanggal | Fakta |
| --- | --- |
| 2026-07-10 | Commit awal `59f81e4` sudah memuat `admin_dashboard_screen.dart` di `user_app`. |
| 2026-07-19..23 | `user_app` versi 1.0.3+4 (RC1, portal Basic). |
| sampai 2026-09-19 | `_RoleDashboardGate` memilih `SuperAdminDashboardScreen` / `AdminDashboardScreen` / `TapGoDashboard` menurut peran. |
| 2026-09-19 | Commit `cc0fdd8` "sembunyikan dashboard Admin": 4 berkas, +11/-32 baris. Hanya titik masuknya yang dihapus. |
| 2026-09-23 08:40 UTC | Log produksi: `GET /api/v1/admin/members` dari klien Dart Android. Header `x-tapgo-app-version: 1.0.3+4` **tidak menunjukkan versi**: klien mengirim konstanta itu dari semua build sejak 2026-07-19. Yang terbukti hanya bahwa ada build sebelum 2026-09-19 yang masih memanggil rute admin. |
| 2026-09-24 | Screenshot Founder Program di WhatsApp; investigasi ini. |

## 3. Yang terbukti di dalam APK (diuji, bukan diasumsikan)

Dibangun dua APK rilis (arm64) dari SATU pubspec yang sama: (a) `lib/` persis
seperti commit terakhir sebelum pembersihan (kode "disembunyikan"), (b) kode
sesudah penghapusan. Isi `libapp.so` dipindai dengan `strings`.

| String | APK lama (disembunyikan) | APK baru (dihapus) |
| --- | --- | --- |
| `/wallet/withdrawals` (kontrol, harus ada) | 1 | 1 |
| `adminFee` (kontrol, sah) | 1 | 1 |
| `/admin/`, `founder-platinum`, `Founder Program`, `Super Admin Dashboard`, `AdminDashboardScreen`, `adminMembers` | 0 | 0 |
| `SUPER_ADMIN` | 1 | 0 |

**Koreksi atas klaim saya sebelumnya.** Saya sempat menyatakan 2.785 baris itu
"ikut terkompilasi ke APK". Itu benar untuk kode sumber dan build debug, tetapi
**tidak benar untuk build rilis**: kompiler Dart AOT membuang kode yang tidak
terjangkau (tree shaking), sehingga APK rilis dari kode 19 September tidak
memuat layar admin. Satu-satunya jejak adalah string `SUPER_ADMIN` dari fungsi
normalisasi peran.

Artinya perlindungan pada periode 19 September sampai hari ini datang dari
**perilaku optimasi kompiler**, bukan dari kontrol yang kita miliki. Satu
referensi baru ke salah satu layar itu akan memasukkannya kembali ke APK tanpa
ada yang menegur. Itulah kegagalan prosesnya. Paparan nyata terjadi pada build
sebelum 19 September (termasuk yang masih beredar, lihat log 23 September).

## 4. Akar masalah

1. **Batas keamanan yang salah tempat.** UI admin berada di aplikasi konsumen dan
   hanya dijaga pemeriksaan peran saat runtime di klien. Pemeriksaan runtime
   bukan batas untuk apa yang kita kirim ke pengguna.
2. **Penanganan lewat penyamaran, bukan penghapusan.** Perbaikan 19 September
   memilih menyembunyikan dan secara eksplisit mempertahankan kode agar tetap
   terkompilasi. Tidak ada aturan yang mewajibkan penghapusan, sehingga
   "dinonaktifkan" sama dengan "masih ada".
3. **Tidak ada kontrol pada artefak.** Tidak ada CI untuk `user_app`, tidak ada
   pemindaian isi APK/AAB sebelum unggah ke Play.
4. **Pengecualian sementara yang tidak pernah kedaluwarsa.** `user_app` dikeluarkan
   dari CI dengan catatan "setelah peringatan `_enabled` dibereskan, tambahkan
   job". Peringatan itu tidak pernah dibereskan, jadi pengecualiannya permanen.
   Penyebabnya sepele: gerbang `skip` tes golden tidak pernah disambungkan.
5. **Klien yang sudah beredar tidak bisa diubah, dan server tidak menolaknya.**
   Rute `/admin` melayani permintaan dari aplikasi mobile tanpa syarat.

## 5. Temuan tambahan dari investigasi ini

- **Kesalahan saya sendiri di pekerjaan Founder hari ini:** saklar
  `FOUNDER_PROGRAM_ENABLED` awalnya hanya dipasang di rute HTTP, padahal
  `scripts/seed-founder-*.ts` memanggil `AdminConsoleService` langsung dan akan
  lolos. Sudah dipindahkan ke inti (service), rute tetap sebagai lapis cepat.
  Pola yang sama dengan akar masalah 1: perlindungan di tepi, bukan di inti.
- **Kesalahan saya sendiri kemarin:** integrasi `sentry_flutter` 8.14.2 didorong
  tanpa build Android sungguhan (hanya analyze dan test). Plugin itu memakai
  Kotlin language version 1.6 sedangkan proyek Kotlin 2.3.20, sehingga
  **build APK rilis `user_app` gagal total**. Diperbaiki dengan memperbarui ke
  9.30.1 (kompilasi terbukti sukses untuk `user_app`).
- **`driver_app` belum pernah bisa dibuild sebagai APK rilis di lingkungan ini**
  (sudah ada sebelum pekerjaan ini): `tflite_flutter` gagal dengan
  "Inconsistent JVM Target (Java 1.8 vs Kotlin 21)". Belum diperbaiki.
- **Header versi aplikasi tidak pernah benar.** `X-TapGo-App-Version` adalah
  konstanta `'1.0.3+4'` di semua build sejak 2026-07-19, sehingga server tidak
  bisa menolak "versi di bawah X". Diperbaiki: klien kini mengirim versi nyata
  dari PackageInfo. Build lama tetap tidak bisa dibedakan berdasarkan versi;
  satu-satunya pembeda yang ada adalah header `X-TapGo-Distribution` (mulai
  2026-09-19).
- Lencana Founder untuk member dan penyimpanan lokal daftar pendaftar (termasuk
  lokasi foto KTP/selfie) sudah dihapus atas keputusan Owner (lihat bagian 6).

## 6. Tindakan yang dilakukan

Penghapusan (bukan penyamaran):
- Dihapus dari `user_app`: 8 layar admin, `demo_admin_data.dart`, 25 metode API
  admin, snapshot provider admin, 23 konstanta katalog endpoint, getter
  `isAdmin`/`isSuperAdmin`, layar "Akses Ditolak" yang tak terpakai, penyimpanan
  status penarikan admin, opsi `showBackButton` yang tak terpakai. Peran apa
  pun dinormalkan menjadi `USER`. Hasil: sekitar 3.200 baris hilang, analyze bersih
  (file yang tercatat di git), 227 tes lulus dan 56 dilewati (tiga di antaranya tes
  golden e-wallet yang kini digerbang sebagaimana maksud aslinya).
- Program Founder Chairman/Platinum dimatikan lewat `FOUNDER_PROGRAM_ENABLED`
  (default `false`): grant dan perubahan status ditolak di rute **dan** di
  service. Pembacaan untuk audit tetap terbuka.

Pencegahan (berlapis):

| Lapis | Berkas | Yang dijaga |
| --- | --- | --- |
| Sumber | `scripts/guard-mobile-no-admin.sh` | Tidak ada `admin_*.dart`, rute `/admin`, `isAdmin`, `SUPER_ADMIN`, rute/judul Founder admin di `user_app` dan `driver_app`. Diuji gagal pada kode lama (91 pelanggaran), lolos pada kode baru. |
| Artefak | `scripts/verify-mobile-artifact.sh` | Memindai isi APK/AAB. Wajib menemukan string kontrol; menolak build debug. Diuji: APK lama GAGAL (`SUPER_ADMIN`), APK baru OK. |
| CI | `.github/workflows/ci.yml` | Tiga job baru: guard sumber, `user_app` analyze+test, build APK rilis (keystore sementara) + pemindaian artefak. Resep build diuji utuh secara lokal. |
| Server | `apps/backend/src/core/http/adminWebOnly.ts` | `/api/v1/admin/*` menolak klien dengan `X-TapGo-Platform: android|ios` (kode `ADMIN_WEB_ONLY`). Menutup build lama yang sudah beredar tanpa menunggu pemilik HP memperbarui. Ini menutup paparan tak disengaja, bukan pertahanan terhadap pemalsuan header; kontrol akses tetap autentikasi + peran. |
| Proses | `GOOGLE_PLAY_FINAL_RELEASE_CHECKLIST.md` | Satu baris wajib: jalankan pemeriksa artefak pada AAB yang akan diunggah. |
| Kebijakan | bagian 8 | Kode yang dinonaktifkan dihapus, bukan disembunyikan. |

- Dihapus atas keputusan Owner: lencana/nama paket Founder di `user_app`, dan
  seluruh penyimpanan lokal pendaftar (`saveRegisteredUser`, pembaca,
  `DemoRegisteredMember`). Data lama di HP dihapus sekali saat aplikasi dibuka
  (`purgeLegacyRegisteredUsers`). Pendaftaran hanya lewat aplikasi resmi Play
  Store dan peningkatan member lewat web.
- Penolakan build lama: `legacyMobileClientGate` menolak klien android/ios tanpa
  `X-TapGo-Distribution` dengan 426 `APP_UPDATE_REQUIRED`. Saklar
  `MOBILE_LEGACY_CLIENT_BLOCK_ENABLED`, default MATI. Batasnya 2026-09-19, bukan
  25 Juli (tidak bisa dibedakan server), sehingga pengguna Play di build 25 Juli
  s.d. 18 September ikut ditolak sampai memperbarui.

Perbaikan yang menyertai: peringatan `_enabled` di `ewallet_visual_test.dart`
(gerbang `skip` disambungkan sesuai maksud aslinya, sama seperti tes saudaranya),
sehingga `user_app` kini bisa masuk CI.

## 7. Belum dilakukan dan keputusan Owner

1. Deploy backend agar `FOUNDER_PROGRAM_ENABLED` (mati) dan `adminWebOnly` aktif
   di produksi. Sebelum deploy, keduanya hanya ada di kode.
2. Build APK/AAB baru dari kode ini (naikkan versi dari 2.0.1+28) dan tarik/hentikan
   rilis lama di Play Console. Aplikasi lama tetap memuat layar admin sampai
   pemiliknya memperbarui; `adminWebOnly` menutup fungsinya di sisi server begitu
   di-deploy.
3. Perbaikan build rilis `driver_app` (tflite_flutter) sebelum ada rilis driver.
4. Menyalakan `MOBILE_LEGACY_CLIENT_BLOCK_ENABLED=true` di produksi setelah build baru dirilis di Play dan pengguna sempat memperbarui (cek sebaran versi di Play Console).
5. Job CI artefak belum pernah berjalan di GitHub Actions sungguhan; resepnya
   sudah diuji lokal, tetapi jalankan sekali dan pastikan hijau sebelum
   menjadikannya syarat merge.

## 8. Kebijakan

> **Kode yang dinonaktifkan dihapus. Tidak disembunyikan, tidak dikunci dengan
> konstanta, tidak dipertahankan "agar tetap terkompilasi".** Riwayat git adalah
> tempat menyimpan kode lama; bila dibutuhkan lagi, ambil dari sana.
>
> Fungsi admin dan Super Admin hanya ada di konsol web dan backend. Aplikasi
> mobile tidak memuat, tidak memanggil, dan tidak mengenal peran admin.
>
> Pengecualian CI harus punya tenggat dan pemilik; pengecualian tanpa tenggat
> dianggap permanen dan dilarang.
>
> Saklar fitur ditegakkan di inti (service), bukan hanya di pintu depan (rute
> atau UI).

## 9. Cara memakai pemeriksa

```bash
# sumber (cepat, tanpa build)
scripts/guard-mobile-no-admin.sh

# artefak (setelah build rilis)
flutter build apk --release   # atau: flutter build appbundle --release
scripts/verify-mobile-artifact.sh apps/user_app/build/app/outputs/flutter-apk/app-release.apk
```
