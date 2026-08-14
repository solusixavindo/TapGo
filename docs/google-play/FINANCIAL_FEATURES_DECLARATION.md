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

