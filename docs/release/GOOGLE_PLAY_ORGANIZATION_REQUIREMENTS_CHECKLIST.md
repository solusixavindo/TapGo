# Google Play Organization Requirements Checklist

Tanggal: 2026-06-18  
Entity target: PT TAPGO LION INDONESIA

## 1. Checklist Account Type

| Item | Status | Catatan |
|---|---:|---|
| Cek account type saat ini | TODO | Play Console > Developer account |
| Jika Personal, konfirmasi ke Play Support | TODO | Tanyakan opsi convert/correct ke Organization |
| Organization target disiapkan | TODO | Gunakan data legal PT |
| Google Payments profile cocok legal entity | TODO | Nama/alamat harus sesuai |
| Account owner memakai email yang aman | TODO | Hindari akses personal yang tidak terkendali |

## 2. Checklist Dokumen Organisasi

| Dokumen/Data | Status | Catatan |
|---|---:|---|
| D-U-N-S number | TODO | Wajib untuk organization account kecuali kasus khusus |
| Nama legal PT | TODO | Harus cocok dengan D-U-N-S/payment profile |
| Alamat legal PT | TODO | Harus cocok dengan D-U-N-S/payment profile |
| Nomor telepon organisasi | TODO | Aktif dan dapat diverifikasi |
| Website organisasi | TODO | `https://tapgolion.id` |
| Email organisasi | TODO | Disarankan domain resmi |
| Contact person | TODO | Nama/legal contact yang dapat dihubungi |
| Contact email | TODO | Untuk Google menghubungi developer |
| Contact phone | TODO | Untuk verifikasi |
| Developer email publik | TODO | Tampil di Google Play |
| Developer phone publik | TODO | Tampil di Google Play untuk Organization |

Sumber: [Required information to create a Play Console developer account](https://support.google.com/googleplay/android-developer/answer/13628312)

## 3. Checklist Google Payments / Merchant

| Item | Status | Catatan |
|---|---:|---|
| Google Payments profile organisasi | TODO | Harus cocok legal entity |
| Payment method verified | TODO | Jika memakai Google monetization |
| Merchant account | REVIEW | Diperlukan jika Google Play Billing dipakai |
| Midtrans docs terpisah | READY/REVIEW | Tetap untuk payment gateway eksternal |

## 4. Checklist App Content

| Area | Required | Status |
|---|---:|---:|
| Financial features declaration | YA | TODO |
| Data Safety | YA | REVIEW |
| App access | YA jika login required | TODO |
| Ads declaration | YA | TODO |
| Target audience | YA | TODO |
| Content rating | YA | TODO |
| Account deletion | YA | REVIEW |
| Privacy Policy URL | YA | REVIEW |
| Terms URL | Recommended | REVIEW |
| Payment disclosure | YA | TODO |

## 5. Checklist Financial Features Declaration

Deklarasikan fitur yang benar-benar ada:

- Paid membership package.
- Wallet / app balance.
- PPOB balance/benefit.
- Referral commission.
- Sponsor bonus.
- Level bonus.
- Withdrawal/payout.
- Payment gateway integration.
- Financial/admin reporting.
- Profit sharing jika tersedia/ditampilkan.

Jangan deklarasikan fitur yang tidak ada:

- Personal loan.
- Payday loan.
- Peer-to-peer lending.
- Crypto trading.
- Gambling.
- Securities/investment trading.

## 6. Checklist Store Listing Wording

Hindari:

- investasi
- profit dijamin
- passive income pasti
- cepat kaya
- money game
- ROI pasti
- penghasilan otomatis

Gunakan:

- membership benefit
- referral reward sesuai syarat
- komisi sesuai ketentuan
- wallet aplikasi
- PPOB benefit
- pembayaran membership
- komunitas usaha digital

## 7. Checklist Reviewer Access

| Item | Status |
|---|---:|
| Credential user test tersedia | TODO |
| Credential admin/super admin hanya jika dibutuhkan reviewer | REVIEW |
| Instruksi testing singkat | TODO |
| Midtrans sandbox/payment channel note | TODO |
| Financial feature explanation | TODO |

## 8. Checklist Sebelum Resubmit

1. Account Organization verified.
2. Financial declaration selesai.
3. Data Safety selesai dan cocok Privacy Policy.
4. Store listing bebas klaim profit/ROI.
5. App access diisi.
6. Payment flow dijelaskan.
7. v3 AAB atau release baru siap upload.
8. Rejection message terdokumentasi untuk appeal/support.

