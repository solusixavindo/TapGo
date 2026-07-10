# TapGo Closed Testing Guide

## Tujuan Testing

Closed Testing bertujuan memastikan aplikasi TapGo stabil, mudah digunakan, dan tidak memiliki bug besar sebelum public launch.

Tester diminta mencoba fitur utama dan melaporkan masalah dengan jelas.

## Checklist Testing

### 1. Install Aplikasi

- Install dari link Google Play Closed Testing.
- Pastikan aplikasi terbuka tanpa crash.

### 2. Registrasi

- Buat akun baru.
- Coba registrasi dengan kode referral jika tersedia.
- Pastikan masuk ke dashboard.

### 3. Login

- Logout.
- Login ulang dengan nomor HP dan password.
- Pastikan tidak kembali ke dashboard setelah logout memakai tombol back.

### 4. Membership

- Buka menu Membership.
- Cek paket Basic, Silver, Gold, Platinum.
- Coba flow checkout sampai invoice.
- Jangan melakukan pembayaran real kecuali diarahkan owner.

### 5. Referral

- Cek kode referral.
- Coba copy referral.
- Cek referral tree jika ada downline.

### 6. Wallet

- Buka Wallet/TapGoPay.
- Cek cash balance.
- Cek riwayat transaksi.
- Pastikan tidak ada error/blank screen.

### 7. PPOB

- Cek PPOB balance.
- Pastikan PPOB tidak tercampur dengan cash wallet.

### 8. Profile

- Buka menu akun.
- Cek bantuan, pengaturan, data akun, dan logout.

### 9. Logout

- Logout dari akun.
- Pastikan kembali ke login screen.

## Cara Melaporkan Bug

Kirim laporan ke admin/support testing dengan format berikut:

```text
Nama tester:
Nomor HP akun:
Device:
Versi Android:
Tanggal/jam:
Fitur yang dites:
Langkah yang dilakukan:
Hasil yang diharapkan:
Hasil yang terjadi:
Severity:
Screenshot/video:
Catatan tambahan:
```

## Severity Bug

### P0 - Blocker

Bug yang membuat aplikasi tidak bisa digunakan atau berisiko pada transaksi/saldo.

Contoh:

- app crash saat login
- tidak bisa register semua user
- saldo salah
- checkout error total

### P1 - Major

Fitur utama terganggu tetapi aplikasi masih bisa digunakan.

Contoh:

- referral tree tidak tampil
- invoice tidak terbuka
- wallet gagal refresh

### P2 - Minor

Masalah tampilan atau wording.

Contoh:

- text terpotong
- warna kurang jelas
- spacing kurang rapi

## Instruksi Screenshot

- Jangan tampilkan password.
- Sensor data rekening/KTP jika ada.
- Kirim screenshot penuh.
- Untuk crash/loading lama, kirim video singkat.

## Catatan Pembayaran

Jangan melakukan pembayaran real kecuali diarahkan owner. Jika Midtrans belum aktif penuh, cukup test sampai invoice/payment page terbuka.
