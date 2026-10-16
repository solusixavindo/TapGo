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
| 4 | Insentif harian | Tabel `driver_incentive_rules` dan `driver_incentive_claims` (migrasi `20261016130000`), nilai enum `INCENTIVE_BONUS`; `DriverIncentiveService`; `GET /driver/incentives`; `GET/POST/PATCH /admin/driver-incentives` + klaim (Super Admin) | Kartu "Insentif hari ini", baris riwayat saldo; konsol: halaman Insentif Driver + tinjauan klaim, baris beban di Laba Rugi | `driverIncentives.integration` (33 kasus), `lateCancelCooldown` (4), `profitLossAccuracy`, `widget_test` |

### Aturan insentif (keamanan uang) — berlapis
Dasar: bonus adalah uang nyata, sedangkan pesanan TUNAI tidak memindahkan uang sungguhan, jadi tanpa pengaman driver dapat memesan
dari akun lain dan memanen bonus. Pengamannya:

1. **Bonus tidak pernah langsung masuk saldo.** Target tercapai membuat klaim `PENDING`. Setelah masa tahan (`INCENTIVE_HOLD_HOURS`,
   bawaan 24 jam) SEMUA perjalanan diverifikasi ulang (masih selesai, dana belum dikembalikan, masih lolos syarat di bawah), baru
   dikreditkan ke saldo yang dapat ditarik. Gagal verifikasi = klaim `REJECTED`, uang tidak bergerak.
2. **Syarat keras per perjalanan (tidak dihitung bila gagal):** selesai; tarif >= minimum aturan; jarak rencana >= 800 m; mulai sampai
   selesai >= 3 menit (waktu dicatat server); jejak GPS driver selama perjalanan bergerak >= 300 m dengan >= 2 titik; penumpang bukan
   sponsor atau downline referral driver; penumpang tidak berbagi perangkat dengan akun driver; penumpang bukan langganan driver
   (>= 3 perjalanan dengan driver ini dalam 6 hari sebelumnya); satu penumpang dihitung SEKALI per hari; beberapa akun penumpang pada
   satu perangkat (langsung atau berantai) dihitung SATU.
3. **Tanda kecurigaan menahan klaim di `REVIEW` (tidak cair otomatis, bahkan setelah masa tahan):** mayoritas penumpang akun baru
   (< 72 jam); mayoritas penumpang belum terverifikasi (email/HP); rute yang sama berulang (>= 60%); >= 30 perjalanan sehari; driver
   pernah punya klaim ditolak atau ditarik kembali dalam 30 hari. Super Admin menyetujui (verifikasi ulang tetap berlaku) atau menolak
   di halaman Insentif Driver > Klaim bonus.
4. **Tarik kembali:** bonus yang sudah dibayar dapat ditarik Super Admin (debit `ADJUSTMENT`, status `REVERSED`) selama saldo yang dapat
   ditarik masih cukup. Bila sudah ditarik/dipakai driver, penarikan kembali ditolak 409 dan perlu ditangani manual.
5. Anggaran harian per aturan dicadangkan saat klaim dibuat (di bawah kunci baris aturan; diuji 5 driver paralel). Klaim unik per
   (aturan, driver, hari): tidak pernah dibayar dua kali (diuji paralel).
6. Bonus Rp1.000-Rp500.000, target 1-100, maksimal 10 aturan aktif. Hanya Super Admin; semua tindakan masuk audit log. Beban Laba Rugi
   dihitung dari bonus yang DIBAYAR (per tanggal pencairan), bukan klaim yang ditahan/ditolak/ditarik.

**Risiko yang tersisa (diterima, ada batasnya):** (a) aplikasi GPS palsu yang menggerakkan titik; (b) driver dengan banyak HP DAN banyak
akun penumpang lama yang terverifikasi dengan rute berbeda-beda. Keduanya mahal (komisi 8%, >= 3 menit per perjalanan, banyak
perangkat) dan klaimnya tetap tersaring tanda kecurigaan, anggaran harian, dan masa tahan 24 jam. Mulai dengan bonus kecil, SELALU pasang
anggaran harian, dan tinjau tab "Perlu tinjauan" setiap hari. Jejak lokasi disimpan 14 hari (`RIDE_LOCATION_RETENTION_DAYS`): klaim
REVIEW yang baru ditinjau setelah itu gagal verifikasi ulang karena jejaknya sudah dibuang, jadi tinjau dalam 14 hari.

### Jeda pembatalan berulang (anti pesan-lalu-batal)
Pembatalan tidak dikenai biaya uang, jadi: penumpang yang membatalkan 3 kali dalam 24 jam SETELAH driver ditugaskan tidak dapat
memesan selama 30 menit (429 `RIDE_PASSENGER_CANCEL_COOLDOWN`); driver yang membatalkan 3 pesanan yang sudah diterima dalam 24 jam
tidak dapat menerima pesanan selama 30 menit (429 `RIDE_DRIVER_CANCEL_COOLDOWN`). Env `RIDE_LATE_CANCEL_LIMIT` (0 = mati) dan
`RIDE_LATE_CANCEL_COOLDOWN_MINUTES`. Biaya batal Rp2.000 tetap hanya dicatat (keputusan kebijakan uang masih di Owner).

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
