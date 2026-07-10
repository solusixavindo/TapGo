# Google Play Asset Revision Report - TapGo

Tanggal: 11 Juni 2026

## Ringkasan

Revisi aset Google Play telah dilakukan tanpa build APK, tanpa deploy, tanpa perubahan backend, dan tanpa perubahan business logic.

## Masalah Feature Graphic Lama

Feature graphic sebelumnya sudah memakai logo resmi TapGo, tetapi teks subtitle terlalu dekat ke sisi kanan sehingga berisiko terkena cropping atau tampak terlalu mepet saat ditampilkan di Google Play Console.

Masalah utama:

- Safe margin kanan belum cukup.
- Subtitle terlalu lebar untuk area teks.
- Elemen visual kanan memberi tekanan visual ke area subtitle.

## Perbaikan Feature Graphic Baru

File:

`google-play-assets/feature-graphic-1024x500.png`

Perbaikan:

- Menjaga safe margin kiri minimal 80 px.
- Menjaga safe margin kanan minimal 100 px.
- Memperkecil dan merapikan subtitle.
- Menggeser dan mengecilkan komposisi visual agar teks tidak dekat tepi.
- Tetap memakai logo resmi TapGo dari `apps/user_app/assets/images/tapgo_logo.jpeg`.
- Tetap memakai ukuran 1024 x 500 px.
- Tetap menggunakan warna brand TapGo: navy, royal blue, teal, dan gold.
- Tidak menampilkan klaim penghasilan, investasi, profit sharing, atau money game.

Preview tambahan:

`google-play-assets/feature-graphic-preview.png`

## Screenshot Template yang Dibuat

Semua template dibuat dalam ukuran portrait 1080 x 1920 px.

| No | File | Judul |
| ---: | --- | --- |
| 1 | `google-play-assets/screenshots/01-dashboard-user-template.png` | Dashboard Premium |
| 2 | `google-play-assets/screenshots/02-membership-package-template.png` | Pilihan Membership |
| 3 | `google-play-assets/screenshots/03-membership-checkout-template.png` | Checkout Membership |
| 4 | `google-play-assets/screenshots/04-wallet-tapgopay-template.png` | TapGoPay & Wallet |
| 5 | `google-play-assets/screenshots/05-referral-network-template.png` | Referral Network |
| 6 | `google-play-assets/screenshots/06-ppob-benefit-template.png` | PPOB & Benefit |
| 7 | `google-play-assets/screenshots/07-admin-dashboard-template.png` | Admin Dashboard |
| 8 | `google-play-assets/screenshots/08-financial-report-template.png` | Financial Report |
| 9 | `google-play-assets/screenshots/09-super-admin-dashboard-template.png` | Super Admin Dashboard |

## Asset yang Sudah Siap Upload

- `google-play-assets/feature-graphic-1024x500.png`

## Asset yang Masih Perlu Diganti Screenshot Asli dari HP

Template berikut belum boleh dianggap screenshot final aplikasi. Area mock phone frame harus diganti dengan screenshot asli dari APK final:

- `01-dashboard-user-template.png`
- `02-membership-package-template.png`
- `03-membership-checkout-template.png`
- `04-wallet-tapgopay-template.png`
- `05-referral-network-template.png`
- `06-ppob-benefit-template.png`
- `07-admin-dashboard-template.png`
- `08-financial-report-template.png`
- `09-super-admin-dashboard-template.png`

## Validasi Ukuran

| File | Expected | Actual | Status |
| --- | --- | --- | --- |
| `feature-graphic-1024x500.png` | 1024 x 500 | 1024 x 500 | PASS |
| `feature-graphic-preview.png` | 1024 x 500 | 1024 x 500 | PASS |
| Semua screenshot template | 1080 x 1920 | 1080 x 1920 | PASS |

## Cropping Safety

Status: Aman untuk feature graphic.

Catatan:

- Teks utama dan subtitle berada jauh dari tepi kanan.
- Logo resmi berada dalam safe area kiri.
- Tidak ada teks atau elemen utama yang terlalu dekat ke tepi.
- Template screenshot memakai judul di area atas dan mock phone frame di tengah dengan margin besar.

## Status Akhir

Feature graphic final siap dipakai untuk Google Play Console.

Screenshot template siap dipakai sebagai layout awal, tetapi masih perlu diganti screenshot asli dari HP sebelum upload final ke Google Play.
