# driver_app — Fase 1: publish pertama langsung ke produksi (15 Oktober 2026)

Keputusan Owner 15 Okt 2026: Play Console langsung **produksi** (akun organisasi, tanpa closed testing wajib), komisi
pesanan tunai **8% menyala sejak peluncuran** (bukan dimatikan selama pilot). Dokumen ini menggantikan bagian rencana
lama yang menyebut komisi mati selama pilot. Rencana besar tetap di `DRIVER_APP_READINESS_PLAN.md`.

## Yang sudah dikerjakan (kode, lulus tes)
| # | Pekerjaan | Di mana | Bukti |
|---|---|---|---|
| 1 | SOS + status keselamatan + pengingat kelelahan masuk jalur produksi (verifikasi wajah ulang tetap mati) | backend cabang `release/driver-phase1` (`10cf38f`) | `driverSos`, `driverFaceCheck`, `driverOffersProximity` |
| 2 | Konsol admin: halaman **SOS Darurat** + hitungan SOS aktif di Beranda VIP (sebelumnya sinyal SOS hanya terlihat lewat API) | `admin_dashboard`, `AdminInsightsService` | `vipInsights` + diperiksa di lab |
| 3 | Akun Google bisa membuat password sendiri untuk masuk tapgolion.id (tanpa ini driver Google **tidak bisa mengisi saldo** sehingga semua pesanan tunai ditolak begitu komisi menyala) | backend `POST /auth/google/set-password`; driver_app Akun > Password tapgolion.id | `googleAuth.integration` (6 tes), `widget_test` (6 tes) |
| 4 | Komisi diuji dengan saldo hasil top up online (hanya `balance`): hold, pelepasan, dan selesai tidak membocorkan ke `cashBalance` | `driverCashCommission.integration` | 18 tes |
| 5 | Lembar tawaran: hitung mundur jujur dari batas pencarian server, rincian tarif/komisi/pendapatan bersih, tombol Terima/Tolak dipasang tetap di bawah (tidak terdorong keluar layar) | driver_app `OfferDetailSheet` + backend `toOfferView` | `widget_test` (5 tes) |

Koreksi atas analisis sebelumnya: aplikasi **sudah** membuka tawaran baru otomatis sebagai lembar detail (dengan bunyi).
Yang belum ada hanyalah hitung mundur dan tampilan komisi; keduanya kini ada. Izin layar penuh saat layar mati sengaja tidak
dipakai: Google Play membatasinya untuk aplikasi panggilan/alarm dan itu risiko penolakan pada review pertama.

## Perilaku komisi saat peluncuran
- Menerima pesanan **tunai** menahan 8% tarif (dibulatkan ke atas) dari Saldo TapGo driver; saldo kurang = tawaran ditolak
  dengan pesan jelas. Dibatalkan = ditahan dikembalikan utuh; selesai = menjadi biaya final.
- Driver wajib punya saldo sebelum bisa menerima: Saldo TapGo diisi lewat tapgolion.id/topup. Top up online memakai Midtrans
  dengan biaya Rp4.440 yang ditanggung pengisi; **transfer manual tidak berbiaya** (dikonfirmasi Super Admin). Karena itu
  `MANUAL_TOPUP_ENABLED` sebaiknya TETAP menyala selama driver memakai jalur ini.
- Pembayaran digital penumpang tetap mati (`RIDE_DIGITAL_PAYMENT_ENABLED` tidak diset): semua perjalanan tunai.

## Syarat sebelum rilis ke produksi
Backend (Owner di VPS, dipandu satu langkah per pesan): cadangan DB; latihan 2 migrasi (`ride_sos_alerts`,
`driver_fatigue_and_face_recheck`) di database sementara; cutover; env `DRIVER_COMMISSION_ENABLED=true`
(`DRIVER_COMMISSION_PERCENT` bawaan 8); pastikan `GOOGLE_OAUTH_CLIENT_ID` terisi; `DRIVER_FACE_CHECK_ENABLED` TIDAK diset;
pasang zip konsol admin baru.

Aplikasi: versi `1.0.0+16`, gerbang rilis lolos, APK diuji Owner di HP (**uji lapangan dua HP, 8 skenario, dua hari berbeda**),
baru AAB untuk Play.

Play Console (Owner): screenshot dari HP, salin Data Safety, deklarasi layanan latar depan lokasi, akun reviewer
(`npm run driver:reviewer-bootstrap`), publikasikan OAuth consent screen keluar dari status Testing, lalu rilis produksi
bertahap (saran: 20% dulu, pantau crash/ANR 2-3 hari).

Rincian langkah: `DRIVER_APP_PLAY_CONSOLE_OWNER_STEPS.md` dan `DRIVER_APP_FIELD_TEST.md`.
