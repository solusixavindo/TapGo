# TapGo driver_app 1.0.0+3

Tanggal mulai: 2026-09-26. Rencana lengkap: `DRIVER_APP_READINESS_PLAN.md`.

## Tahap D1 (selesai): bisa dibangun dan diserahkan
- Build rilis kini berhasil. Tiga penyebab gagal diperbaiki: target JVM plugin `tflite_flutter`, `compileSdk` plugin
  (android-31 vs dependensi AndroidX >= 34), dan aturan R8 untuk delegasi GPU TFLite yang opsional.
- Kunci unggah khusus driver (terpisah dari kunci user_app), disimpan di `apps/driver_app/android/keystore/` (diabaikan git).
- `scripts/release-gate-driver-app.sh` dan job CI `driver_app_release_artifact` (build rilis + pemindai artefak).

## Tahap D2 (selesai): tawaran hanya untuk driver yang dekat
- Driver hanya melihat dan bisa menerima pesanan dalam radius 5 km dari posisi terbarunya (posisi maksimal 60 detik).
  Tawaran diurutkan dari yang terdekat dan menampilkan jarak ke titik jemput.
- Pesanan tanpa driver setelah 3 menit menjadi "Driver belum ditemukan" dan penumpang diberi tahu.

## Tahap D3 (selesai): tetap menerima pesanan saat layar mati
- Layanan latar depan (notifikasi "TapGo Driver aktif") menjaga lokasi tetap terkirim selama driver ONLINE atau
  punya perjalanan; mati otomatis saat OFFLINE.
- Notifikasi push (FCM): pesanan baru di dekat driver, dan pembatalan oleh penumpang.
- Izin baru: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`.

## Tahap D4 (selesai): alur kerja driver
- Pembatalan oleh driver memilih alasan (penumpang tidak bisa dihubungi, titik jemput tidak sesuai, kendaraan
  bermasalah, menunggu terlalu lama, lainnya).
- Tab Pendapatan: **Saldo TapGo**, catatan komisi, tombol isi saldo (tapgolion.id), dan riwayat potongan komisi/isi saldo.
- Komisi 8% pesanan tunai dipotong dari saldo saat perjalanan selesai; pesanan tunai hanya bisa diterima bila
  saldo cukup. **Aktif hanya bila server memasang `DRIVER_COMMISSION_ENABLED=true`.**
- Top up manual transfer bank di tapgolion.id/topup, dikonfirmasi Super Admin (server: `MANUAL_TOPUP_ENABLED=true`).

## Tahap D4.1 (selesai): perbaikan dari uji HP pertama (27 Sep 2026)
4 laporan Owner dari uji `tapgo-driver-1.0.0+3.apk` di HP asli, semuanya diperbaiki dengan akar masalah
dibuktikan dan uji penjaga ditambahkan (lihat `REGRESSION_REGISTER.md`):
- **Online selalu gagal** ("Verifikasi wajah belum diaktifkan"): bug server, bukan hanya tampilan. Setiap
  driver, di setiap kondisi, tidak bisa online selama `DRIVER_FACE_CHECK_ENABLED=false` (nilai bawaan
  sekarang) — diperbaiki di backend, sudah di-deploy terpisah dari paket ini (lihat percakapan deploy).
- **Masuk dengan Google gagal**: server TIDAK PERNAH punya endpoint untuk ini (`/auth/google` 404 sejak awal),
  bukan masalah satu akun. Diperbaiki dan di-deploy di backend; **butuh dua langkah manual dari Owner**
  (`GOOGLE_OAUTH_CLIENT_ID` di `.env` VPS, dan SHA-1 kunci unggah driver didaftarkan di Google Cloud Console)
  sebelum benar-benar berfungsi — lihat pesan terpisah.
- **Kartu "Ajukan Jadi Mitra Driver" nyangkut** di tab Akun walau driver sudah aktif: disembunyikan otomatis
  begitu driver punya kendaraan aktif.
- **Ikon aplikasi**: latar kotak navy dihapus, tersisa lencana emas (bingkai + lambang) pada latar transparan.

Sekaligus dikerjakan (bagian dari permintaan "menu selevel Gojek/Grab"): tab Akun sekarang punya kartu
**Tampilan** (Terang/Gelap/Ikuti sistem, tersimpan permanen) dan **Notifikasi** (tombol ke pengaturan
notifikasi bawaan Android — suara/getar diatur Android sejak versi 8, aplikasi tidak bisa mengubahnya
langsung), serta kartu **Bantuan** (WhatsApp dan Kebijakan Privasi, kontak sama dengan aplikasi penumpang).

**Temuan keamanan yang BELUM diperbaiki, dilaporkan ke Owner secara terpisah:** verifikasi wajah harian
mempercayai skor kemiripan yang dihitung DAN dikirim oleh aplikasi sendiri — server tidak menghitung ulang
dari foto. Ini desain lama (didokumentasikan di skema Prisma), bukan sesuatu yang baru rusak, tetapi berarti
aplikasi yang dimodifikasi bisa melewati verifikasi tanpa wajah asli di depan kamera. Perbaikan penuhnya
butuh pemrosesan di server (perubahan arsitektur, bukan tambalan kecil) — belum dikerjakan, menunggu
keputusan Owner, dan tidak mendesak selama `DRIVER_FACE_CHECK_ENABLED` masih mati.

## Belum tercakup (jujur)
- Tidak ada uji di HP nyata untuk layanan latar depan, push, dan face check. Uji lapangan dua HP (lihat
  `DRIVER_APP_READINESS_PLAN.md`) wajib sebelum produksi.
- Penalti pembatalan driver belum ada (menunggu keputusan bisnis). Gerbang versi minimum untuk driver (D5) belum ada.
- Pemeriksaan visual tema terang/gelap driver_app di emulator belum dilakukan pada tahap ini.
