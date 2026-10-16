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
- Driver wajib punya saldo sebelum bisa menerima pesanan tunai: Saldo TapGo diisi lewat tapgolion.id/topup (Midtrans). Biaya untuk
  driver dibatasi Rp2.500 (`WALLET_TOPUP_FEE_CAP`); selisih biaya Midtrans ditanggung perusahaan. Keputusan Owner 16 Okt 2026:
  transfer manual TIDAK dipertahankan (`MANUAL_TOPUP_ENABLED=false`), dimatikan setelah uji top up nyata lolos. Metode yang
  ditawarkan diatur `WALLET_TOPUP_METHODS` (bawaan hanya transfer bank; GoPay QRIS dan DANA belum aktif).
- **Koreksi 16 Okt 2026:** `RIDE_DIGITAL_PAYMENT_ENABLED=true` di produksi (terbaca dari `.env`), jadi perjalanan DIGITAL (TapGoPay) juga ada.
  Perjalanan digital: penumpang membayar dari Saldo TapGo, driver menerima 92% ke saldo (dapat ditarik lewat tapgolion.id), perusahaan 8%
  (dipotong dari tarif, bukan ditahan dari saldo driver). Komisi tahan-saldo hanya untuk perjalanan TUNAI.
- Batas biaya top up Rp2.500 berlaku hanya untuk akun yang punya profil driver; penumpang membayar biaya penuh (top up penumpang hanya
  memberi perusahaan 8% dari tarif, tidak cukup menanggung Rp1.940).
- Driver_app belum punya layar tarik saldo/dompet: penarikan penghasilan digital lewat tapgolion.id (butuh password web: fitur Akun > Password tapgolion.id).

## Pemeriksaan menyeluruh 16 Okt 2026 (sebelum push)
| # | Temuan / permintaan | Tindakan | Bukti |
|---|---|---|---|
| 1 | Posisi driver menuju titik jemput harus terlihat penumpang <= 3 detik | driver_app 1 dtk (menuju/menunggu penumpang), 2 dtk (mengantar), 15 dtk (idle), GPS mode cepat; user_app ambil tiap 1,5 dtk dengan marker bergerak halus | e2e HTTP nyata: umur posisi saat diterima penumpang 218-808 ms |
| 2 | Pembatas laju per IP (CGNAT operator seluler) menjerat posisi, tulis perjalanan, dan polling umum | pembatas posisi dan tulis perjalanan per akun; dua rute posisi dikecualikan dari batas umum 120/mnt per IP (plafon IP longgar sebagai gantinya) | `passengerDriverLocation`, `liveRidePositionRateLimit`, e2e |
| 3 | Tabel `ride_driver_locations` tidak pernah dibersihkan | `purgeOldDriverLocations` tiap jam; jejak perjalanan 14 hari (`RIDE_LOCATION_RETENTION_DAYS`), titik idle 1 hari | `rideLocationRetention` |
| 4 | Halaman Pernyataan hanya 3 butir, dan ada di akhir pendaftaran | 10 bagian lengkap, kini LANGKAH PERTAMA wizard (sebelum unggah KTP/SIM/STNK/foto diri dan isi data diri), persetujuan terkunci sampai naskah digulir habis, halaman baca ulang di Akun > Bantuan, versi naskah dicatat di audit | `widget_test`, `driverApplication` |
| 5 | Saldo driver basi setelah isi saldo di peramban | muat ulang saat kembali ke aplikasi + tarik layar | `widget_test` |
| 6 | Halaman top up: biaya basi, galat diam, pesan rentang keliru | diperbaiki dan diperiksa di peramban terhadap backend lab | lihat REGRESSION_REGISTER |
| 8 | Keputusan Owner: biaya top up Saldo PPOB dibatasi Rp2.500 untuk semua nominal dan semua pelanggan | `PPOB_TOPUP_FEE_CAP` (bawaan 2500), landing menuliskan batasnya, beban tercatat di Laba Rugi | `midtransTopUpFees`, `onlineTopUp.integration` |
| 7 | Driver tidak melihat nilai biaya terhadap pendapatan yang dibuka | halaman top up menulis kapasitas komisi ("cukup untuk komisi 8% pesanan tunai senilai sekitar ...") | `onlineTopUp.integration` |

| 9 | Keputusan Owner 16 Okt: pesanan tunai hanya bisa diterima bila Saldo TapGo driver >= Rp50.000 (dihitung SEBELUM komisi ditahan) dan peringatan isi saldo saat saldo <= Rp10.000 | `DRIVER_MIN_CASH_BALANCE=50000` (bawaan 0 = mati) menolak tawaran tunai dengan 402 `RIDE_CASH_MIN_BALANCE` (dicek pada baca-tulis atomik yang sama dengan penahanan komisi); `DRIVER_LOW_BALANCE_WARN` (bawaan 10000); ringkasan saldo membawa `minCashBalance` dan `lowBalanceWarnAt`; aplikasi: banner di Beranda dan peringatan di kartu saldo; landing: kalimat top up mengikuti batas; Pernyataan v2026-10-16.2 | `driverCashCommission` (batas, serentak, nonaktif), `onlineTopUp`, `widget_test` |

Catatan keterbatasan: uji ujung-ke-ujung berjalan di satu mesin dengan jaringan lokal; waktu radio seluler dan penerimaan GPS HP
ditambahkan di atas angka itu, jadi batas 3 detik harus dikonfirmasi lagi pada uji lapangan dua HP.

Temuan yang BUKAN bagian pekerjaan ini tetapi perlu diketahui: biaya pembatalan penumpang Rp2.000 dicatat di pesanan (`cancellationFee`)
tetapi tidak ditagihkan (dana digital dikembalikan penuh), jadi pernyataan driver sengaja tidak menjanjikan kompensasi pembatalan.

## Syarat sebelum rilis ke produksi
Backend (Owner di VPS, dipandu satu langkah per pesan): cadangan DB; latihan 2 migrasi (`ride_sos_alerts`,
`driver_fatigue_and_face_recheck`) di database sementara; cutover; env `DRIVER_COMMISSION_ENABLED=true`
(`DRIVER_COMMISSION_PERCENT` bawaan 8), `DRIVER_MIN_CASH_BALANCE=50000`; pastikan `GOOGLE_OAUTH_CLIENT_ID` terisi dan `WALLET_TOPUP_ENABLED=true`; `DRIVER_FACE_CHECK_ENABLED` TIDAK diset;
pasang zip konsol admin baru.

Aplikasi: versi `1.0.0+16`, gerbang rilis lolos, APK diuji Owner di HP (**uji lapangan dua HP, 8 skenario, dua hari berbeda**),
baru AAB untuk Play.

Play Console (Owner): screenshot dari HP, salin Data Safety, deklarasi layanan latar depan lokasi, akun reviewer
(`npm run driver:reviewer-bootstrap`), publikasikan OAuth consent screen keluar dari status Testing, lalu rilis produksi
bertahap (saran: 20% dulu, pantau crash/ANR 2-3 hari).

Rincian langkah: `DRIVER_APP_PLAY_CONSOLE_OWNER_STEPS.md` dan `DRIVER_APP_FIELD_TEST.md`.
