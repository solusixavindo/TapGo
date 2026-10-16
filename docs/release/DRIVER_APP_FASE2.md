# driver_app — Fase 2 "layak bersaing" (16 Oktober 2026)

Keputusan Owner 16 Okt 2026: Fase 2 dikerjakan sekaligus dengan publish pertama ke Play. Rencana awal (Fase 2 di analisis driver):
rating dan ulasan, penilaian penumpang oleh driver, insentif harian, telepon anonim, peta area ramai, antrean offline, pusat
bantuan, dompet dan pencairan di aplikasi.

## Yang dikerjakan

| # | Fitur | Backend | Aplikasi / konsol | Uji penjaga |
|---|---|---|---|---|
| 1 | Penilaian penumpang → driver terlihat driver | `GET /driver/ratings`; `performance` memuat `ratingAverage`/`ratingCount` (null bila belum ada) | Kartu Performa + layar "Penilaian penumpang" | `rideRatingAndRejectionSignal` (3 kasus), `widget_test` (2) |
| 2 | Driver menilai penumpang | Tabel baru `ride_passenger_ratings` (migrasi `20261016120000`), `POST /driver/rides/:ref/rate-passenger`; satu per order, hanya driver order itu, hanya setelah selesai | Panel penilaian setelah perjalanan selesai (boleh dilewati) | `rideRatingAndRejectionSignal` (2), `widget_test` (2) |
| 3 | Pusat Bantuan | Memakai `/support/tickets` yang sudah ada | Akun > Bantuan > Pusat Bantuan: FAQ + tiket + balasan tim | `widget_test` (3) |
| 4 | Insentif harian | Tabel `driver_incentive_rules` dan `driver_incentive_claims` (migrasi `20261016130000`), nilai enum `INCENTIVE_BONUS`; `DriverIncentiveService`; `GET /driver/incentives`; `GET/POST/PATCH /admin/driver-incentives` (Super Admin) | Kartu "Insentif hari ini", baris riwayat saldo; konsol: halaman Insentif Driver, baris beban di Laba Rugi | `driverIncentives.integration` (13 kasus), `profitLossAccuracy`, `widget_test` (3) |

### Aturan insentif (keamanan uang)
- Bonus Rp1.000-Rp500.000, target 1-100 perjalanan, maksimal 10 aturan aktif, tanggal mulai/berakhir opsional.
- Hanya perjalanan SELESAI dengan tarif >= minimum aturan yang dihitung; hari dihitung WIB (00.00-24.00).
- Bonus masuk ke saldo yang DAPAT DITARIK + catatan buku saldo `INCENTIVE_BONUS`; klaim unik per (aturan, driver, hari) sehingga tidak
  pernah dibayar dua kali (diuji paralel). Evaluasi berjalan setelah perjalanan commit dan tidak pernah menggagalkannya; bila gagal,
  evaluasi berikutnya (perjalanan lain atau driver membuka kartu) menyusul.
- Anggaran harian per aturan (opsional): pengecekan dilakukan di bawah kunci baris aturan, jadi driver yang mencapai target bersamaan
  tidak dapat melampaui anggaran (diuji 5 driver paralel, anggaran untuk 3).
- Hanya Super Admin yang dapat membuat/mengubah aturan; semua perubahan tercatat di audit log; aturan tidak dihapus (hanya dinonaktifkan).
- Pembukuan: bonus yang dibayar menjadi beban usaha "Insentif harian driver" di Laba Rugi.
- **Risiko yang tersisa**: tidak ada deteksi kecurangan (mis. driver memesan perjalanan dari akun lain sendiri). Pengaman yang ada:
  tarif minimum per aturan, anggaran harian, dan batas bonus. Disarankan mulai dengan aturan kecil dan anggaran harian terpasang.

## Yang SENGAJA tidak dikerjakan
- **Telepon anonim**: butuh penyedia telepon virtual berbayar (kontrak dan biaya per menit); tidak ada di kode. Chat dalam aplikasi tetap ada.
- **Peta area ramai**: butuh data permintaan nyata untuk menentukan area; dengan volume awal petanya menyesatkan. Tunda sampai ada data.
- **Antrean offline**: menyimpan aksi perjalanan saat tidak ada sinyal berisiko status ganda atau basi (terima/selesai terlambat);
  perlu data uji lapangan jaringan sebelum dirancang. Pemulihan jaringan yang ada (polling, pemulihan sesi) tetap berlaku.
- **Penarikan di dalam aplikasi**: `WALLET_CASH_OUT_ENABLED` sengaja mati untuk rilis Play (keputusan sebelumnya); penarikan lewat
  tapgolion.id (butuh `WALLET_CASH_OUT_WEB_ENABLED=true`, periksa di .env produksi). Pusat Bantuan menjelaskannya kepada driver.

## Syarat rilis
Backend (Owner di VPS, dipandu): cadangan DB; latihan DUA migrasi baru (`ride_passenger_ratings`, `driver_incentives` yang menambah
nilai enum) di database sementara; cutover; env tambahan `WALLET_TRANSFER_ENABLED=true`; zip konsol admin baru (halaman Insentif
Driver + baris Laba Rugi). Setelah backend aktif: buat aturan insentif pertama di konsol (opsional, tanpa aturan kartu tidak tampil).
