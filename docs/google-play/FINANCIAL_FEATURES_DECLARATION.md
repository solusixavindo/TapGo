# Financial Features Declaration - TapGo

Tanggal: 15 Juli 2026

## Ringkasan Produk

TapGo adalah aplikasi membership digital dengan fitur wallet aplikasi, PPOB benefit, referral reward sesuai syarat, invoice, pembayaran membership, dan withdrawal saldo cash yang eligible.

## Yang Bukan Merupakan Layanan TapGo

TapGo v1.0 tidak menyediakan:

- Pinjaman/kredit.
- Investasi.
- Trading aset.
- Deposit investasi.
- Janji keuntungan tetap.
- Klaim penghasilan pasti.

## Fitur Finansial yang Perlu Dideklarasikan

| Fitur | Deklarasi Aman |
|---|---|
| Membership berbayar | Customer membeli paket membership digital. |
| Wallet aplikasi | Wallet mencatat saldo cash yang eligible, ledger, bonus/reward yang tervalidasi, dan withdrawal. |
| PPOB benefit | PPOB benefit terpisah dari cash wallet dan tidak boleh dianggap saldo withdrawable. |
| Referral/bonus | Reward/komisi sesuai syarat dan hanya dari transaksi valid. Tidak ada janji pendapatan. |
| Withdrawal | Penarikan hanya dari saldo cash yang memenuhi syarat dan melalui review admin. |
| Payment gateway | DOKU sebagai primary; Midtrans sebagai secondary/fallback; Xendit tidak digunakan pada TapGo v1.0. |

## Credential Payment Gateway

Credential DOKU/Midtrans hanya berada di backend/server environment. Flutter app tidak menyimpan server key, secret key, private key, database credential, atau JWT secret.

## Klaim Yang Harus Dihindari

Jangan gunakan kata/frasa:

- investasi
- keuntungan pasti
- pendapatan tanpa batas
- cepat kaya
- guaranteed income
- profit dijamin



## Pembaruan 14 November 2026: kunci bonus dan penarikan deposit (belum aktif)

Perubahan produk (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4), diaktifkan lewat bendera server `BONUS_LOCK_ENABLED`:

| Hal | Keadaan | Dampak pada deklarasi Play |
|---|---|---|
| Bonus membership dipecah: sebagian dapat ditarik, sebagian dikunci sebagai Saldo TapGo | Aturan internal ledger | Tidak menambah kategori fitur finansial; wallet dan penarikan sudah dideklarasikan. |
| Deposit pribadi dapat ditarik kembali (biaya tetap) | **Hanya di situs web** (tapgolion.id), disetujui admin | Aplikasi Android **tidak** memuat tombol, layar, atau endpoint penarikan (dijaga `scripts/guard-mobile-no-admin.sh`). |
| Saldo TapGo dapat dipakai membeli PPOB | Di aplikasi (PPOB sudah ada) | Mengubah sumber dana PPOB dari satu menjadi dua saldo; sama-sama saldo internal, bukan metode pembayaran baru. |
| Aplikasi menampilkan rincian saldo (dapat dipakai, terkunci, deposit) | Hanya tampilan, tanpa tombol/tautan di kartu | Tidak mengumpulkan data baru; Data Safety tidak berubah. |

Yang TIDAK berubah dan tetap dijaga: aplikasi tidak memproses pembayaran eksternal; kata "komisi", "pencairan", "withdraw" dan tautan
tapgolion.id tidak muncul di layar rincian saldo (diuji di `wallet_screen_test.dart`); tidak ada klaim penghasilan.

Catatan jujur: tautan "Isi Saldo di tapgolion.id" yang sudah ada di layar saldo dan PPOB adalah keputusan Owner sebelumnya dan
bukan bagian perubahan ini. Kecocokannya dengan kebijakan Payments Google Play harus diperiksa Owner/penasihat kebijakan;
dokumen ini tidak menjaminnya.
