# Audit driver_app 1.0.0+4 — laporan akar masalah dan perbaikan (4 Oktober 2026)

Pemicu: Owner menguji `tapgo-driver-1.0.0+4.apk` di HP dan melaporkan kemunduran; halaman Login
menampilkan "Koneksi belum stabil. Silakan coba lagi." Permintaan: cari akar masalah tanpa asumsi,
periksa tiap halaman/tombol/fitur, laporkan lalu perbaiki, periksa ulang, bangun ulang APK dan AAB.

## 1. Akar masalah halaman Login

**Pin TLS yang tertanam di APK sudah basi.** Bukan kesalahan kode dan bukan build tanpa pin.

Rantai sebab, masing-masing dibuktikan (bukan diasumsikan):

1. Build rilis memakai `--dart-define=TAPGO_TLS_PIN_SHA256=<hash SPKI leaf>`. String itu ditemukan
   tertanam di `libapp.so` APK +4 (dibongkar dan dicari langsung), jadi pin ada.
2. Pin = hash SHA-256 SPKI sertifikat **leaf**. Sertifikat server diperbarui 3 Oktober 2026, dan
   Let's Encrypt menerbitkan **kunci baru** pada tiap perpanjangan. SPKI yang disajikan server sekarang
   berbeda dari yang ada di APK (dihitung ulang dengan `openssl` dari sertifikat live).
3. Fungsi pin aplikasi (`tapGoShouldAcceptPinnedCertificate`) dijalankan terhadap sertifikat live:
   pin lama ditolak, pin baru diterima. Handshake gagal untuk SETIAP permintaan, bukan hanya login.
4. `_performRequest` memetakan semua `DioException` tanpa respons menjadi `NETWORK_ERROR` dengan pesan
   "Koneksi belum stabil", sehingga kegagalan sertifikat tampak seperti masalah sinyal dan tidak ada
   petunjuk sebabnya.
5. Mengapa semua uji hijau: tidak ada uji handshake TLS sungguhan dan tidak ada pemeriksaan pin
   terhadap server live. Gerbang rilis hanya memastikan variabel pin tidak kosong.

Konsekuensi: **user_app memakai desain pin yang sama dan akan rusak dengan cara yang sama** pada
perpanjangan berikutnya (atau sudah rusak bila dibangun dengan pin lama).

## 2. Temuan audit dan status perbaikan

| # | Tingkat | Temuan | Perbaikan | Uji |
|---|---|---|---|---|
| H1 | Tinggi | Kegagalan TLS dilebur menjadi "Koneksi belum stabil"; tidak ada diagnosis | Kode `TLS_PIN_MISMATCH`, `TLS_PIN_NOT_CONFIGURED`, `TLS_CERTIFICATE_INVALID` dengan pesan yang bisa ditindaklanjuti; laporan sekali ke Sentry (kode + host saja) | `api_error_mapping_test.dart` (handshake TLS sungguhan) |
| H2 | Tinggi | Pesan galat server berbahasa Inggris tampil ke driver (`INVALID_CREDENTIALS`, `ROUTE_NOT_FOUND`, `VALIDATION_ERROR`, `ACCOUNT_INACTIVE`, tiga kode rate limit) | Dipetakan ke pesan Indonesia | `api_error_mapping_test.dart` |
| H3 | Tinggi | Login 401 (kata sandi salah) melempar driver ke layar "Sesi berakhir" tanpa form login | Alur login selalu kembali ke form login | `widget_test.dart` |
| H4 | Tinggi | Gangguan jaringan sesaat saat polling mengganti seluruh workspace dengan layar galat dan **menghentikan polling + pengiriman lokasi** sampai driver menekan "Coba lagi" (bug lama, paling berbahaya saat di tengah perjalanan) | Refresh latar belakang diam terhadap gangguan sesaat; setelah 3 kali gagal hanya pesan non-blokir; perubahan status akun sungguhan tetap menutup workspace | `widget_test.dart` (dibuktikan dengan mutasi) |
| H5 | Tinggi | Vektor uji memuat sertifikat produksi dan hash pin lama | Diganti sertifikat sintetis, hash dihitung independen lewat openssl (driver dan user_app) | `tls_pinning_test.dart` kedua aplikasi |
| M1 | Sedang | Tidak ada pemeriksaan pin terhadap server live; tidak ada runbook rotasi | `scripts/check-tls-pin-live.sh`, langkah 3b dan pemeriksaan `libapp.so` di gerbang rilis, bagian 14.1 `DEPLOY_VPS.md` | skrip diuji: pin lama ditolak (exit 1) |
| M2 | Sedang | `RECORD_AUDIO` terbawa dari plugin kamera dan `READ_MEDIA_IMAGES` dideklarasikan, padahal tidak dipakai | Dihapus di manifest; gerbang menolak APK yang masih memuatnya | gerbang langkah 5 |
| M3 | Sedang | Foto wajah sementara dari `takePicture()` tidak pernah dihapus | Dihapus di `finally` | — |
| M4 | Sedang | SOS: galat tak terduga membuat tombol macet pada "mengirim" | Ditangkap dengan pesan Indonesia; WhatsApp CS tetap tersedia | `widget_test.dart` |
| M5 | Sedang | Wizard pengajuan tertutup oleh pesan galat yang kebetulan memuat kata "terkirim" | Keberhasilan dibaca dari status pengajuan, bukan teks | `widget_test.dart` |
| M6 | Sedang | `topUpUrl` dari server dibuka langsung di aplikasi eksternal | Hanya https ke `tapgolion.id`/subdomain; selain itu tautan bawaan | `api_error_mapping_test.dart` |
| L1 | Rendah | Warna teks hard-coded (`black54`, `grey[600/700]`, bubble chat putih) tidak terbaca di mode gelap | Memakai `colorScheme.onSurfaceVariant`/`surfaceContainerHighest`/`onSurface` | `flutter analyze` |

## 3. Temuan yang tidak dapat diselesaikan dari kode

1. **Perpanjangan sertifikat berikutnya (±awal Desember 2026) akan memutus APK ini lagi** kecuali di VPS
   certbot memakai `reuse_key = True` (langkah di `DEPLOY_VPS.md` bagian 14.1; pekerjaan VPS dilakukan
   Owner). Alternatif jangka panjang yang lebih tahan: pin ke kunci intermediate atau pin ganda
   (kunci lama + baru) pada rilis berikutnya. Itu keputusan keamanan Owner.
2. **Backend produksi belum memuat endpoint dari PR #1.** `POST /driver/sos`,
   `GET /driver/safety-status`, dan `POST /driver/face-check/recheck-attempt` hanya ada di PR #1
   (belum dirilis). Di produksi saat ini ketiganya membalas `ROUTE_NOT_FOUND`: SOS gagal (kini dengan
   pesan jelas dan jalur WhatsApp CS), banner kelelahan dan verifikasi ulang wajah tidak muncul.
3. **Model verifikasi wajah tidak dibundel** (`FaceCheckModelUnavailableException`); fitur itu
   mati di server (`DRIVER_FACE_CHECK_ENABLED`) sehingga tidak terlihat, tetapi tidak boleh dinyalakan
   sebelum model tersedia dan E2 selesai.
4. Uji lapangan 2 HP (E1), closed testing (E6), dan isi Play Console tetap tindakan Owner. Dokumen ini
   **tidak** menyatakan driver_app siap 100%.
5. Hasil klik-tembus di HP sungguhan belum ada; audit ini berbasis pembacaan kode, uji otomatis, dan
   handshake TLS lokal. Login ke server produksi sungguhan hanya bisa dibuktikan Owner di HP.

## 4. Cakupan audit

Dibaca dan diperiksa: `main.dart`, composition/guards, penyimpanan sesi dan koordinator refresh token,
`api_driver_repository.dart`, `driver_controller.dart`, seluruh `driver_screens.dart`, lokasi, push,
dokumen, verifikasi wajah dan pipeline-nya, chat, riwayat, penghasilan, wizard pengajuan, model data,
tema, `tls_pinning.dart`, manifest sumber dan manifest APK +4, Gradle dan ProGuard.
Tidak tercakup: perilaku di perangkat nyata, FCM sungguhan, GPS sungguhan, kamera sungguhan.

## 5. Pemeriksaan ulang dan artefak

- `flutter analyze`: bersih (semua level). `flutter test` (urutan acak): 160 lolos, 20 dilewati (`visual_evidence_test`, bawaan).
- Uji mutasi: dengan jalur refresh latar belakang dimatikan, uji gangguan jaringan gagal (layar `network-error` muncul); dengan perbaikan, lolos.
- Skrip pemeriksa pin diuji: pin lama ditolak (keluar 1) terhadap sertifikat live, pin live diterima.
- Gerbang rilis lolos sampai langkah 6 (guard sumber, analyze, tes, pin live, build, pemeriksa artefak, izin terlarang, salin).
- Artefak: pin live ada di `libapp.so` ketiga ABI; `RECORD_AUDIO`/`READ_MEDIA_IMAGES`/`ACCESS_BACKGROUND_LOCATION` tidak ada; package `com.xavindo.tapgo.driver` versionCode 4; tanda tangan APK terverifikasi (v2) dan AAB `jar verified`, sidik jari kunci sama dengan APK lama sehingga dapat menimpa pemasangan sebelumnya.
- Berkas lama dipindah (tidak dihapus) ke `~/Desktop/tapgo-driver-arsip/` dengan akhiran `-PIN-BASI-1okt`.

## 6. Koreksi (4 Okt 2026, setelah cek ulang)

Analisis akar masalah di bagian 1 **tidak lengkap**. Pin yang basi memang tidak cocok dengan sertifikat
baru, tetapi pin leaf yang benar pun tidak akan pernah cocok: terhadap rantai produksi, callback
`badCertificateCallback` menerima sertifikat teratas (ISRG Root X2), bukan leaf. Karena itu temuan H5
dan M1 (pin leaf, `scripts/check-tls-pin-live.sh`) digantikan oleh trust-anchor pinning dan gerbang
handshake sungguhan; lihat `TLS_TRUST_ANCHORS.md`. Pernyataan di bagian 5 bahwa pin live "ada di
`libapp.so`" membuktikan pin tertanam, bukan bahwa aplikasi dapat terhubung.
