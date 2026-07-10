# TapGo Closed Testing Pack

Tanggal: 2026-06-17

## Tujuan Closed Testing

Closed Testing bertujuan memastikan aplikasi TapGo stabil di perangkat real sebelum public launch, khususnya:

- registrasi dan login
- dashboard premium
- membership package
- checkout membership
- wallet/TapGoPay
- PPOB balance
- referral tree
- profile/logout
- admin/super admin jika tester internal
- crash, blank screen, overflow, loading infinite

## Jumlah Tester Ideal

Target: **12-20 tester aktif**

Komposisi ideal:

- 8-12 user umum
- 2-4 tester admin internal
- 2-4 device berbeda untuk variasi Android versi dan ukuran layar

## Syarat Tester

- Memiliki akun Google yang bisa menerima invitation Closed Testing.
- Menggunakan HP Android pribadi.
- Bersedia mengisi feedback harian.
- Bersedia mengirim screenshot/video jika menemukan bug.
- Tidak melakukan pembayaran real kecuali diarahkan owner.
- Tidak membagikan APK/link testing ke publik.

## Cara Bergabung sebagai Tester

1. Kirim email Google tester ke admin TapGo.
2. Tunggu invitation/link Closed Testing.
3. Buka link dari HP Android.
4. Install TapGo dari Play Store testing channel.
5. Jalankan skenario test harian.
6. Isi Google Form feedback.

## Checklist Testing Harian

| No | Skenario | Expected |
| --- | --- | --- |
| 1 | Install dari Play Store | App terinstall tanpa warning. |
| 2 | Register | User bisa daftar tanpa crash. |
| 3 | Login | User bisa login. |
| 4 | Dashboard | Dashboard terbuka, saldo/data tampil atau error state profesional. |
| 5 | Membership package | Paket Basic/Silver/Gold/Platinum tampil. |
| 6 | Checkout membership | Order/invoice terbentuk. |
| 7 | Midtrans page jika tersedia | User diarahkan ke payment page. |
| 8 | Referral | Kode referral tampil/copy; tree tampil jika ada downline. |
| 9 | Wallet | Cash/PPOB balance tampil jelas. |
| 10 | PPOB | Benefit/saldo PPOB tampil, tidak tercampur cash. |
| 11 | Profile | Menu akun, bantuan, pengaturan, logout berjalan. |
| 12 | Logout | User kembali ke login dan tidak bisa back ke dashboard. |

## Skenario Detail

### User Basic

- Register user baru.
- Login.
- Cek dashboard.
- Cek referral code.
- Cek wallet cash dan PPOB.
- Logout.
- Login ulang.

### Referral

- User A register.
- User B register memakai kode A.
- Cek referral tree A.
- Cek wallet/aktivitas sesuai rule yang aktif.

### Membership

- Buka menu membership.
- Pilih Silver.
- Isi form.
- Checkout.
- Pastikan invoice muncul.
- Klik bayar jika diarahkan owner.

### Admin Internal

- Login Admin.
- Cek dashboard.
- Cek membership list.
- Cek withdrawal list.
- Cek report.
- Logout.

## Severity Bug

| Severity | Definisi | Contoh |
| --- | --- | --- |
| P0 Blocker | App crash, login gagal total, payment rusak, data uang salah. | Tidak bisa login, checkout 500, saldo salah. |
| P1 Major | Fitur utama terganggu tetapi app masih bisa dipakai. | Referral tree kosong padahal ada data, invoice tidak tampil. |
| P2 Minor | UI/wording/overflow kecil. | Text terlalu panjang, spacing kurang rapi. |

## Format Laporan Bug

```text
Nama tester:
Device:
Android version:
App version:
Tanggal/jam:
Role akun:
Langkah reproduce:
Expected:
Actual:
Severity:
Screenshot/video:
Catatan tambahan:
```

## Instruksi Screenshot Bug

- Sertakan seluruh layar.
- Jangan tampilkan password.
- Sensor nomor rekening/KTP/token jika ada.
- Ambil video singkat untuk crash atau loading infinite.
- Sertakan jam kejadian.

## Instruksi Pembayaran

Tester tidak boleh melakukan pembayaran real kecuali diarahkan owner.

Jika Midtrans masih onboarding:

- Cukup test sampai invoice dan payment page terbuka.
- Jangan memaksa memilih channel/payment jika belum aktif.

## Template Google Form Feedback

Pertanyaan:

1. Nama tester.
2. Email Google tester.
3. Nomor HP akun TapGo yang digunakan.
4. Device dan Android version.
5. App version.
6. Role yang dites: User/Admin/Super Admin.
7. Apakah install dari Play Store berhasil?
8. Apakah register berhasil?
9. Apakah login berhasil?
10. Apakah dashboard tampil normal?
11. Apakah wallet/TapGoPay tampil benar?
12. Apakah PPOB balance tampil benar?
13. Apakah membership package tampil benar?
14. Apakah checkout/invoice berhasil?
15. Apakah referral code/tree berjalan?
16. Apakah logout berhasil?
17. Bug yang ditemukan.
18. Severity bug.
19. Upload screenshot/video.
20. Saran perbaikan.
21. Skor pengalaman penggunaan 1-10.

## Checklist 14 Hari

| Hari | Fokus |
| --- | --- |
| 1 | Install, register, login, logout. |
| 2 | Dashboard, dark/light mode, scroll. |
| 3 | Membership package. |
| 4 | Checkout dan invoice. |
| 5 | Wallet/TapGoPay/PPOB. |
| 6 | Referral code dan copy link. |
| 7 | Referral tree. |
| 8 | Profile, bantuan, pengaturan. |
| 9 | Withdraw form tanpa payout real. |
| 10 | Admin dashboard internal. |
| 11 | Admin membership/withdraw report. |
| 12 | Super Admin financial report internal. |
| 13 | Regression semua P0/P1. |
| 14 | Final feedback dan readiness. |

## Closed Testing Exit Criteria

Closed Testing dianggap siap lanjut jika:

- Tidak ada P0 open.
- P1 utama sudah diperbaiki atau punya workaround aman.
- Tidak ada crash berulang.
- Tidak ada saldo/financial data salah.
- Feedback tester minimal cukup baik.
- Midtrans/payment flow sudah jelas statusnya.
