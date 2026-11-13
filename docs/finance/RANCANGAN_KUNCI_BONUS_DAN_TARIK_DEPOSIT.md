# Rancangan: kunci 20% bonus membership dan penarikan deposit

Sumber: Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4 (12 Nov 2026) dan jawaban Owner (12 Nov 2026).
Status: **RANCANGAN, belum diterapkan.** Menunggu hasil simulasi dan persetujuan Owner. Kode belum diubah.

## 1. Aturan dari Owner (final)

1. Bonus membership = **seluruh bonus mesin bisnis**: sponsor, level, reward, bagi hasil, insentif driver.
2. Setiap bonus yang masuk dipecah: **80% dapat ditarik**, **20% dikunci** sebagai Saldo TapGo.
3. Saldo terkunci **boleh dipakai** untuk perjalanan dan PPOB, **tidak boleh ditarik**.
4. **Deposit pribadi** (top up) boleh ditarik kembali: **seluruh saldo yang belum terpakai**, **biaya Rp10.000**.
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
- Jumlah = seluruh `depositBalance` (atau sebagian); biaya tetap Rp10.000 dipotong dari jumlah; harus sisa positif.
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

## 5. Keputusan yang masih perlu persetujuan Owner (disertai usulan)

1. **Urutan pemakaian saldo.** Usulan: lain-lain, lalu terkunci, lalu deposit, lalu yang dapat ditarik.
2. **Kekurangan pada migrasi** (pengguna yang sudah menarik lebih dari 80% bonusnya). Usulan: **tidak ditagih**,
   hanya dicatat; tidak ada saldo yang dibuat negatif.
3. **Penarikan deposit, pembatas.** Usulan: hanya dari deposit yang sudah mengendap **24 jam** sejak top up
   terakhir; minimal tarik Rp50.000 (sama dengan penarikan bonus); disetujui admin; saldo hasil transfer masuk
   **tidak** dihitung deposit.
4. **Driver.** Saldo TapGo driver menahan komisi pesanan tunai. Usulan: deposit driver tidak boleh ditarik
   selama ada pesanan tunai berjalan, dan saldo minimal untuk menerima pesanan tunai tetap berlaku.
5. **Persetujuan pengguna.** Pengguna lama kehilangan hak tarik atas 20% bonus lamanya. Usulan: pemberitahuan di
   aplikasi/web sebelum migrasi dijalankan, dan pembaruan Syarat & Ketentuan.

## 6. Tahapan (tidak ada yang menyentuh produksi sebelum persetujuan)

1. Simulasi di produksi (hanya membaca) lalu tinjauan Owner. **<- sekarang**
2. Persetujuan keputusan di bagian 5.
3. Migrasi skema (dua kolom baru, bawaan 0) + fungsi bersama + tujuh berkas diubah + tes uang (termasuk balapan,
   pembulatan, invarian, idempoten). Fitur dimatikan lewat bendera `BONUS_LOCK_ENABLED` (bawaan mati).
4. Uji penuh di database uji; golden test mesin bisnis diperbarui secara sadar (bonus kini terpecah 80/20).
5. Rilis backend dengan bendera mati; jalankan migrasi surut; nyalakan bendera; pantau.
6. Tampilan: rincian saldo (dapat ditarik / terkunci / deposit) di web dan aplikasi, tombol tarik deposit di web
   (pembayaran dan penarikan tetap di web sesuai kebijakan Google Play).
