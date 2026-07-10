# Google Play Transfer Risk Analysis

Tanggal: 2026-06-18  
Aplikasi: TapGo  
Package: `id.tapgolion.tapgo`

## 1. Tujuan

Menganalisis apakah TapGo lebih aman:

1. Mengubah akun saat ini menjadi Organization; atau
2. Membuat Organization account baru lalu transfer aplikasi.

## 2. Dasar Resmi Transfer

Google menyatakan app bisa ditransfer ke developer account lain. Namun ada dampak:

- Users, download statistics, ratings/reviews, content ratings, dan store listing ikut transfer.
- Beberapa reports tidak ikut transfer.
- Target account harus aktif/registered.
- App dengan in-app products/paid app membutuhkan payments profile aktif.
- Integrated services seperti Firebase/Google APIs perlu update setting.
- **Test groups tidak bisa ditransfer**; closed testing groups harus dibuat ulang dan user mungkin perlu opt-in ulang.

Sumber: [Transfer apps to a different developer account](https://support.google.com/googleplay/android-developer/answer/6230247)

## 3. Opsi A — Convert / Correct Current Account to Organization

| Area | Risiko | Catatan |
|---|---:|---|
| Package continuity | Rendah | Package tetap di akun sama |
| Closed testing | Rendah | Tester group kemungkinan tetap |
| Tester opt-in | Rendah | Tidak perlu opt-in ulang jika akun sama |
| v2 tester access | Rendah | Tidak terganggu |
| v3 resubmission | Rendah | Resubmit setelah account verified |
| Operational complexity | Sedang | Perlu Play Support jika tidak ada self-service |
| Verification | Sedang | Perlu D-U-N-S dan data PT |

Kelebihan utama:

- Paling minim gangguan operasional.
- Tidak perlu transfer.
- Tidak merusak testing aktif.

Kekurangan:

- Belum pasti Google menyediakan konversi account type untuk akun yang sudah ada.
- Jika akun awal dibuat Personal dengan Google Payments personal, bisa perlu proses support/manual.

## 4. Opsi B — New Organization Account + Transfer App

| Area | Risiko | Catatan |
|---|---:|---|
| Package continuity | Sedang | Aman jika transfer resmi berhasil |
| Closed testing | Tinggi | Test groups tidak ikut transfer |
| Tester opt-in | Tinggi | Tester mungkin harus opt-in ulang |
| Store listing | Rendah | Ikut transfer |
| Ratings/reviews | Rendah | Ikut transfer |
| Reports | Sedang | Bulk/export/payout/earnings reports tertentu tidak ikut |
| Firebase/integrations | Sedang | Perlu relink/update permissions |
| Time to resolve | Sedang | Transfer request direview Google |

Kelebihan:

- Organization account bersih sejak awal.
- Data legal PT bisa disiapkan dari awal.

Kekurangan:

- Closed Testing yang sedang berjalan akan terganggu karena test groups tidak ikut transfer.
- Tester bisa perlu daftar ulang.
- Ada risiko delay operasional.

## 5. Risiko terhadap `id.tapgolion.tapgo`

| Skenario | Risiko |
|---|---|
| Convert akun sama | Rendah |
| Transfer resmi | Rendah-sedang |
| Buat app baru/package baru | Tinggi, tidak direkomendasikan |

Jangan membuat aplikasi baru dengan package berbeda kecuali benar-benar tidak ada opsi lain. Itu akan memecah riwayat testing, branding, dan release.

## 6. Dampak terhadap Closed Testing

| Skenario | Dampak |
|---|---|
| Account current dikonversi | Closed Testing kemungkinan tetap |
| Transfer app | Closed Testing groups tidak ikut transfer; perlu recreate |
| App baru | Closed Testing mulai dari nol |

## 7. Dampak terhadap Midtrans Approval

| Skenario | Dampak |
|---|---|
| Convert akun sama | Minimal; package tetap |
| Transfer app | Kemungkinan perlu update dokumen jika developer account/link Play berubah |
| App baru | Risiko besar; Midtrans dokumen/screenshot/package bisa perlu revisi |

## 8. Dampak terhadap Future Public Launch

Organization account justru memperkuat trust:

- Nama legal developer lebih jelas.
- Phone dan email developer publik lebih lengkap.
- Cocok untuk financial features.
- Lebih sesuai untuk PT TAPGO LION INDONESIA.

## 9. Rekomendasi Transfer Strategy

**Rekomendasi utama: Opsi A — ubah/verify akun saat ini menjadi Organization.**

Alasan:

- Closed Testing sedang aktif.
- v2 sudah tersedia untuk tester.
- Transfer akan membuat test groups tidak ikut pindah.
- Package continuity paling aman jika tetap di akun sama.

**Fallback: Opsi B — buat Organization account baru dan transfer app**, hanya jika Google Play Support menyatakan akun saat ini tidak bisa dikonversi/correct ke Organization.

