# Google Play Screenshot Capture Guide - TapGo

Target folder:

`google-play-assets/screenshots/`

## Resolusi yang Disarankan

- Portrait: 1080 x 1920 atau 1080 x 2400 px.
- Gunakan Android device real atau emulator dengan tampilan bersih.
- Ambil screenshot dari APK final production/UAT yang mengarah ke `https://api.tapgolion.id`.

## Aturan Umum

- Gunakan akun UAT, bukan data pribadi user asli.
- Jangan tampilkan password, token, KTP, rekening penuh, atau informasi sensitif.
- Pastikan tidak ada debug banner, error popup, loading screen, atau data dummy.
- Jika ada nomor rekening, sensor sebagian digit.
- Jika ada nomor HP user UAT, pastikan nomor tersebut aman untuk ditampilkan atau sensor sebagian.

## 01 Dashboard User Premium

Nama file:

`01-dashboard-user-premium.png`

Halaman:

Dashboard user setelah login.

Data yang harus terlihat:

- Header user.
- TapGoPay/cash wallet.
- PPOB benefit jika ada.
- Referral Saya / Downline Saya.
- Menu utama.
- Branding premium dashboard.

Data yang harus disensor:

- Nomor HP lengkap jika tampil.
- Saldo production asli jika bukan akun UAT.

## 02 Membership Package

Nama file:

`02-membership-package.png`

Halaman:

Menu Membership / paket membership.

Data yang harus terlihat:

- Basic, Silver, Gold, Platinum.
- Harga paket.
- Benefit paket.

Data yang harus disensor:

- Tidak ada data sensitif, selama menggunakan akun UAT.

## 03 Membership Checkout

Nama file:

`03-membership-checkout.png`

Halaman:

Checkout/ringkasan order membership.

Data yang harus terlihat:

- Paket yang dipilih.
- Nominal.
- Nama user UAT.
- Status order atau tombol bayar.

Data yang harus disensor:

- Nomor HP lengkap jika tampil.
- Identitas user asli.

## 04 Wallet TapGoPay

Nama file:

`04-wallet-tapgopay.png`

Halaman:

Wallet / Riwayat transaksi.

Data yang harus terlihat:

- Cash wallet / TapGoPay.
- PPOB benefit.
- Riwayat transaksi UAT.
- Empty state profesional jika data kosong.

Data yang harus disensor:

- Nomor rekening.
- Nama pemilik rekening asli.
- Nominal production asli jika bukan data UAT.

## 05 Referral Network

Nama file:

`05-referral-network.png`

Halaman:

Referral Tree / Jaringan Saya.

Data yang harus terlihat:

- Root user UAT.
- Downline UAT.
- Level referral.
- Summary referral.

Data yang harus disensor:

- Nomor HP downline jika tampil.
- Nama user production asli.

## 06 PPOB Benefit

Nama file:

`06-ppob-benefit.png`

Halaman:

Dashboard atau Membership Benefit yang menampilkan PPOB.

Data yang harus terlihat:

- PPOB Basic/Silver/Gold/Platinum sesuai akun UAT.
- Benefit paket.

Data yang harus disensor:

- Tidak ada data sensitif, selama memakai data UAT.

## 07 Membership Card

Nama file:

`07-membership-card.png`

Halaman:

Dashboard atau profil membership aktif.

Data yang harus terlihat:

- Paket aktif.
- Kode referral.
- Benefit singkat.

Data yang harus disensor:

- Kode referral boleh ditampilkan jika akun UAT.
- Sensor jika memakai akun production pribadi.

## 08 Admin Dashboard

Nama file:

`08-admin-dashboard.png`

Halaman:

Dashboard Admin.

Data yang harus terlihat:

- Summary admin.
- Membership request.
- Withdrawal request.
- User management ringkas.

Data yang harus disensor:

- Nama/nomor HP user production.
- Nomor rekening.
- Data finansial production yang sensitif.

## 09 Financial Report

Nama file:

`09-financial-report.png`

Halaman:

Financial report / admin financial summary.

Data yang harus terlihat:

- Summary cash wallet.
- PPOB liability.
- Reward/commission/profit sharing summary jika tersedia.

Data yang harus disensor:

- Nominal production real jika bukan data UAT.
- Detail user dan rekening.

## 10 Super Admin Dashboard

Nama file:

`10-super-admin-dashboard.png`

Halaman:

Dashboard Super Admin.

Data yang harus terlihat:

- Super Admin summary.
- Membership, wallet, reward, PPOB, financial report overview.

Data yang harus disensor:

- Semua data user production yang sensitif.
- Detail bank, nomor HP, token, atau data admin internal.
