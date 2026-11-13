# Rancangan: kunci 20% bonus membership dan penarikan deposit

Sumber: Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4 (12 Nov 2026) dan jawaban Owner (12 Nov 2026).
Status: **BACKEND DIBANGUN, bendera `BONUS_LOCK_ENABLED` MATI (belum aktif di produksi).** Keputusan Owner sudah final
(lihat bagian 5). Tampilan web/aplikasi untuk rincian saldo dan tombol tarik deposit belum dibangun (bagian 7).
Kode: cabang `release/driver-phase1` (commit dfb6e7a ... e742fae).

## 1. Aturan dari Owner (final)

1. Bonus membership = **seluruh bonus mesin bisnis**: sponsor, level, reward, bagi hasil, insentif driver.
2. Setiap bonus yang masuk dipecah: **80% dapat ditarik**, **20% dikunci** sebagai Saldo TapGo.
3. Saldo terkunci **boleh dipakai** untuk perjalanan dan PPOB, **tidak boleh ditarik**.
4. **Deposit pribadi** (top up) boleh ditarik kembali: **seluruh saldo yang belum terpakai**, **biaya Rp2.000** (diubah Owner 14 Nov 2026 dari Rp10.000).
5. Aturan berlaku juga untuk **bonus yang sudah masuk sebelumnya** (berlaku surut).

## 2. Model saldo sekarang (dibaca dari kode)

| Kolom `wallets` | Arti | Dapat ditarik |
|---|---|---|
| `balance` | Saldo TapGo total | sebagian |
| `cashBalance` | bagian `balance` yang dapat ditarik (bonus, komisi, insentif); selalu `<= balance` | ya |
| `ppobBalance` | Saldo PPOB terpisah (bonus registrasi, top up PPOB) | tidak |

- `balance - cashBalance` ("non-tarik") berisi top up, transfer masuk, dan pengembalian dana. Tidak ada pembeda di antara mereka.
- Bonus dikreditkan dengan menambah `balance` dan `cashBalance` **seluruhnya** di enam tempat:
  `PrismaReferralRepository.creditCommission`, `MembershipOrderService.creditSponsorBonus`,
  `MembershipOrderService.creditLevelBonuses`, `ProfitSharingService.postDistributionIfMissing`,
  `AdminConsoleService.markRewardPaid`, `DriverIncentiveService.settleClaim` (pembaliknya: `reverseClaim`).
- Penarikan (`reserveWithdrawal`) mengurangi `cashBalance` dan `balance`; ditolak mengembalikannya.
  Minimal Rp50.000, biaya bawaan 0 (kolom `fee` sudah ada).
- Berkas yang mengubah `balance` (semua harus ikut aturan baru): `PrismaWalletRepository`, `RideService`,
  `MembershipOrderService`, `PrismaReferralRepository`, `ProfitSharingService`, `AdminConsoleService`, `DriverIncentiveService`.

## 3. Rancangan pembukuan

Dua kolom baru di `wallets`:

- `lockedBonusBalance` : bonus terkunci (20%). Bagian dari `balance`, **bukan** dari `cashBalance`.
- `depositBalance`     : deposit pribadi yang dapat ditarik kembali (dari top up). Bagian dari `balance`.

Selisih `balance - cashBalance - lockedBonusBalance - depositBalance` = "lain-lain" (transfer masuk, pengembalian
dana, penyesuaian) yang **tidak dapat ditarik**. Pemisahan ini sengaja: tanpa kolom deposit sendiri, saldo hasil
transfer dari orang lain ikut menjadi "deposit" dan bisa diuangkan (celah pencucian uang).

**Invarian** (diperiksa tes dan skrip audit): semua kolom `>= 0`;
`cashBalance + lockedBonusBalance + depositBalance <= balance`.

**Kredit:**
- Bonus `X`: `balance += X`, `cashBalance += 80% X`, `lockedBonusBalance += 20% X`. Pembulatan: bagian terkunci
  dibulatkan **ke bawah** ke rupiah; sisanya ke bagian yang dapat ditarik (jumlah selalu persis `X`).
- Top up berhasil: `balance += X`, `depositBalance += X`.
- Pembalikan bonus (insentif ditarik kembali): kurangi dengan pecahan yang sama (80/20).

**Debit (membayar perjalanan, PPOB, komisi tunai, transfer keluar)** menghabiskan, berurutan:
1. lain-lain, 2. `lockedBonusBalance`, 3. `depositBalance`, 4. `cashBalance`.
(Usulan; lihat keputusan 1. Alasannya: saldo yang tidak dapat ditarik dipakai lebih dulu supaya hak tarik pengguna
bertahan selama mungkin.) Satu fungsi bersama menghitung pembagian ini dan semua jalur memakainya, dengan pembaruan
bersyarat (`updateMany ... where kolom >= nilai`) seperti pola yang sekarang, agar balapan permintaan tidak membuat
kolom negatif.

**Penarikan deposit (baru):**
- Jumlah = seluruh `depositBalance` (atau sebagian); biaya tetap Rp2.000 dipotong dari jumlah; harus sisa positif.
- Mencatat `Withdrawal` dengan sumber `DEPOSIT`, melewati persetujuan admin yang sama seperti penarikan bonus.
- Mengurangi `depositBalance` dan `balance`. Ditolak mengembalikannya.
- Aturan anti-penyalahgunaan: lihat keputusan 3.

## 4. Berlaku surut (migrasi)

Per pengguna, memakai buku besar `wallet_transactions`:

```
total_bonus = SUM(SPONSOR_BONUS, BASIC_SPONSOR_BONUS, LEVEL_BONUS, REWARD_BONUS,
                  PROFIT_SHARING, PROFIT_SHARING_BONUS, INCENTIVE_BONUS)
              - pembalikan insentif driver (ADJUSTMENT / DRIVER_INCENTIVE_REVERSAL)
dikunci     = 20% x total_bonus
dipindah    = MIN(dikunci, cashBalance)        -- tidak pernah membuat saldo negatif
kekurangan  = dikunci - dipindah               -- sudah terlanjur ditarik/dipakai
```

Pemindahan: `cashBalance -= dipindah`, `lockedBonusBalance += dipindah`, `balance` tidak berubah. Satu baris
`ADJUSTMENT` (referensi `BONUS_LOCK_MIGRATION`) per pengguna di buku besar, sehingga dapat diaudit dan tidak
terhitung ulang. Skrip migrasi **idempoten** (dijalankan dua kali tidak menggandakan) dan dijalankan **sesudah**
cadangan database dan **sesudah** Owner menyetujui laporan simulasi.

Deposit lama: `depositBalance` awal = `MIN(balance - cashBalance, total top up)` (konservatif). Hanya perkiraan;
angka simulasi bagian 5 menunjukkan besarnya.

**Simulasi (hanya membaca):** `docs/finance/simulasi-kunci-bonus-20persen.sql` melaporkan berapa pengguna
terdampak, berapa rupiah berpindah, siapa yang tidak cukup saldo (kekurangan), dan perkiraan deposit.
Diuji di database uji dengan data buatan; angkanya cocok dengan hitungan manual.

## 5. Keputusan Owner (final, 14 Nov 2026)

1. Kunci 20% berlaku untuk **semua akun tanpa kecuali**, termasuk Super Admin (Rp1.342.000 pada simulasi).
2. Urutan pemakaian saldo: lain-lain, terkunci, deposit, lalu yang dapat ditarik. (Komisi tunai driver tetap
   dimulai dari yang dapat ditarik, seperti perilaku lama.)
3. Kekurangan akibat penarikan lama **tidak ditagih**, hanya dicatat.
4. Penarikan deposit: **biaya Rp2.000**, **minimal Rp50.000**, setelah deposit **mengendap 24 jam** sejak top up
   terakhir, disetujui admin; ditolak bila ada pesanan tunai berjalan (komisi ditahan).
5. Pengguna diberi tahu sebelum migrasi (termasuk pengguna yang seluruh saldo tariknya akan terkunci).

Keputusan ini **membalik** dua keputusan lama, dicatat agar tidak terulang sebagai "temuan": (a) 14 Okt 2026 "uang top up
tidak dapat ditarik"; (b) audit 30 Sep 2026 (M1) "Saldo PPOB tidak boleh tercampur dengan saldo utama" (kini Saldo
TapGo boleh dipakai untuk PPOB, Saldo PPOB dipakai dulu).

## 6. Tahapan (tidak ada yang menyentuh produksi sebelum persetujuan)

1. Simulasi di produksi (hanya membaca) lalu tinjauan Owner. **<- sekarang**
2. Persetujuan keputusan di bagian 5.
3. Migrasi skema (dua kolom baru, bawaan 0) + fungsi bersama + tujuh berkas diubah + tes uang (termasuk balapan,
   pembulatan, invarian, idempoten). Fitur dimatikan lewat bendera `BONUS_LOCK_ENABLED` (bawaan mati).
4. Uji penuh di database uji; golden test mesin bisnis diperbarui secara sadar (bonus kini terpecah 80/20).
5. Rilis backend dengan bendera mati; jalankan migrasi surut; nyalakan bendera; pantau.
6. Tampilan: rincian saldo (dapat ditarik / terkunci / deposit) di web dan aplikasi, tombol tarik deposit di web
   (pembayaran dan penarikan tetap di web sesuai kebijakan Google Play).

## 7. Yang sudah dibangun dan yang belum

Sudah (backend, diuji, bendera mati):
- Kolom `lockedBonusBalance`, `depositBalance`, `withdrawals.source` + batasan database (tidak ada kantong negatif; jumlah
  kantong <= saldo). Fungsi murni `walletBuckets.ts` (diuji 10.000 kombinasi acak).
- Kredit bonus 80/20 di enam jalur (sponsor, level, reward, bagi hasil, insentif) dan pembalikan insentif yang tepat.
- Debit menurut kantong: bayar perjalanan, penahanan komisi tunai, transfer P2P (penerima tidak bisa membuka kunci atau
  mengubah deposit jadi tunai), PPOB dari Saldo TapGo (Saldo PPOB dulu), semua dengan pembalikan persis.
- Top up Saldo TapGo dicatat sebagai deposit; penarikan deposit (web); penolakan admin mengembalikan ke deposit.
- Ringkasan dompet `GET /web/wallet` dan `GET /wallet` menyajikan `breakdown`, `depositWithdrawal`, `lockPercent`.
- Skrip migrasi surut `scripts/bonus-lock-migration.ts` (simulasi bawaan, idempoten).
- Layar admin Penarikan Dana: sumber, biaya, dan jumlah yang harus ditransfer.

Web (tapgolion.id, 14 Nov 2026): kartu rincian saldo di Dompet; Tarik dana memilih sumber (saldo / deposit) dengan biaya,
minimal, dan masa tunggu; riwayat menandai pengembalian deposit. Hanya tampil bila server mengirim persen kunci > 0.

Belum: rincian saldo di aplikasi Play (user_app/driver_app); Syarat & Ketentuan dan pemberitahuan pengguna; layar admin
untuk melihat kantong per anggota.

## 8. Urutan pemasangan (setelah Owner menyetujui)

1. Rilis backend dengan bendera mati (migrasi skema menambah kolom saja). Tidak ada perubahan perilaku.
2. Cadangan database. Jalankan simulasi `scripts/bonus-lock-migration.ts`; Owner meninjau.
3. Beri tahu pengguna terdampak.
4. Nyalakan `BONUS_LOCK_ENABLED=true`, mulai ulang `tapgo-api`.
5. Segera jalankan `scripts/bonus-lock-migration.ts --apply --confirm-backup-sudah-dibuat` (aman sesudah bendera menyala).
6. Periksa invarian dan laporan; pasang tampilan web/aplikasi.
