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

## Belum tercakup (jujur)
- Tidak ada uji di HP nyata untuk layanan latar depan, push, dan face check. Uji lapangan dua HP (lihat
  `DRIVER_APP_READINESS_PLAN.md`) wajib sebelum produksi.
- Penalti pembatalan driver belum ada (menunggu keputusan bisnis). Gerbang versi minimum untuk driver (D5) belum ada.
- Pemeriksaan visual tema terang/gelap driver_app di emulator belum dilakukan pada tahap ini.
