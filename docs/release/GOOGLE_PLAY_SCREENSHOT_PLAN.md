# Google Play Screenshot Plan - TapGo

Folder output screenshot:

`google-play-assets/screenshots/`

## Prinsip Screenshot

- Gunakan APK production/UAT terbaru yang mengarah ke `https://api.tapgolion.id`.
- Gunakan akun UAT, bukan data pribadi pengguna asli.
- Jangan tampilkan password, token, nomor rekening penuh, KTP, atau data sensitif lain.
- Pastikan layar bersih, tidak ada error banner, tidak ada debug overlay, dan tidak ada data dummy.
- Ambil screenshot dalam rasio portrait Android yang umum, misalnya 1080 x 1920 atau 1080 x 2400.
- Jika ada saldo/transaksi, gunakan data UAT yang aman untuk publik.

## Daftar Screenshot Wajib

| No | Nama File | Layar | Tujuan Visual |
| ---: | --- | --- | --- |
| 1 | `01-dashboard-premium.png` | Dashboard Premium | Menampilkan identitas TapGo, TapGoPay, membership aktif, referral, dan layanan utama. |
| 2 | `02-membership-package.png` | Membership Package | Menampilkan paket Basic, Silver, Gold, Platinum, harga, dan benefit. |
| 3 | `03-checkout-membership.png` | Checkout Membership | Menampilkan ringkasan order membership sebelum pembayaran. |
| 4 | `04-wallet-tapgopay.png` | Wallet / TapGoPay | Menampilkan cash wallet, PPOB benefit, riwayat, dan status transaksi. |
| 5 | `05-referral-tree.png` | Referral Tree | Menampilkan jaringan referral user UAT dengan data aman. |
| 6 | `06-ppob-benefit.png` | PPOB / Benefit | Menampilkan PPOB benefit per paket atau ringkasan benefit member. |
| 7 | `07-admin-dashboard.png` | Admin Dashboard | Menampilkan panel admin dengan data operasional UAT. |
| 8 | `08-super-admin-financial-report.png` | Super Admin Financial Report | Menampilkan summary finansial, wallet liability, reward, PPOB, atau komisi. |

## Urutan Upload yang Disarankan

1. Dashboard Premium
2. Membership Package
3. Checkout Membership
4. Wallet / TapGoPay
5. Referral Tree
6. PPOB / Benefit
7. Admin Dashboard
8. Super Admin Financial Report

## Catatan Reviewer

Untuk screenshot admin dan super admin, gunakan akun UAT resmi dan pastikan tidak ada data production sensitif. Bila Google Play hanya membutuhkan screenshot user-facing, screenshot admin dapat disimpan sebagai materi internal dan tidak diunggah.
