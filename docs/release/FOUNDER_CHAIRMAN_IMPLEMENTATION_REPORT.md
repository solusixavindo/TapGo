# Founder Chairman Implementation Report

Tanggal: 2026-07-15

## Ringkasan

Founder Chairman ditambahkan sebagai posisi tunggal tertinggi dalam Founder Program TapGo. Akun ini efektif sebagai Platinum aktif, tetapi diberikan gratis sebagai akun penghormatan dan bukan transaksi pembelian.

## Aturan Bisnis

- Maksimal 1 akun Founder Chairman.
- Founder ID resmi: `FCH-001`.
- Tidak termasuk kuota 10 Founder Platinum.
- Membership efektif: Platinum `ACTIVE`.
- Tidak membuat membership order, invoice, payment, atau revenue.
- Tidak memberi PPOB benefit otomatis.
- Wallet awal `cashBalance = 0` dan `ppobBalance = 0`.
- Grant tidak memicu sponsor bonus, level bonus, reward, profit sharing, atau revenue.
- Akun `ACTIVE` tetap boleh menjadi sponsor dan menerima bonus dari downline yang membayar membership valid.
- Akun `SUSPENDED` atau `REVOKED` tidak menerima bonus baru.
- Tidak ada endpoint delete.

## Backend

Endpoint baru, seluruhnya `SUPER_ADMIN` only:

- `POST /api/v1/admin/founder-chairman/grant`
- `GET /api/v1/admin/founder-chairman`
- `GET /api/v1/admin/founder-chairman/:founderId`
- `PATCH /api/v1/admin/founder-chairman/:founderId/status`

Attempt grant kedua ditolak dengan:

```text
FOUNDER_CHAIRMAN_ALREADY_EXISTS
```

## Data Sensitif Rekening

Nomor rekening tidak di-hardcode di source code, tidak ditulis ke dokumentasi publik, dan tidak dicetak penuh dalam response. Seed script membaca rekening hanya dari environment lokal:

- `FOUNDER_CHAIRMAN_BANK_NAME`
- `FOUNDER_CHAIRMAN_BANK_ACCOUNT_NAME`
- `FOUNDER_CHAIRMAN_BANK_ACCOUNT_NUMBER`

Response admin hanya menampilkan `bankAccountMasked`, contoh format `******1234`.

## Migration

Migration baru:

`apps/backend/prisma/migrations/0015_founder_chairman_program/migration.sql`
`apps/backend/prisma/migrations/0016_founder_chairman_unique_guard/migration.sql`

Perubahan:

- Menambah enum `FOUNDER_CHAIRMAN` pada `FounderRole`.
- Menambah unique partial index agar hanya ada satu grant Founder Chairman.

Migration bersifat additive dan tidak mengubah data Founder Platinum existing.

## Seed Script

Script:

`scripts/seed-founder-chairman.ts`

Dry run:

```bash
npm --workspace apps/backend run seed:founder-chairman
```

Execute:

```bash
TAPGO_FOUNDER_CHAIRMAN_CONFIRM=YES \
FOUNDER_CHAIRMAN_INITIAL_PASSWORD="<isi-di-terminal-lokal>" \
FOUNDER_CHAIRMAN_BANK_NAME="<isi-di-terminal-lokal>" \
FOUNDER_CHAIRMAN_BANK_ACCOUNT_NAME="<isi-di-terminal-lokal>" \
FOUNDER_CHAIRMAN_BANK_ACCOUNT_NUMBER="<isi-di-terminal-lokal>" \
npm --workspace apps/backend run seed:founder-chairman -- --execute
```

Jangan commit `.env`, password, atau nomor rekening.

## Admin Console

Menu `Founder Program` menampilkan:

- Card Founder Chairman.
- Founder ID.
- Nama, phone, email.
- Membership `Founder Chairman / Platinum`.
- Status `ACTIVE`, `SUSPENDED`, `REVOKED`.
- Wallet cash dan PPOB.
- Referral count.
- Sponsor bonus, level bonus, total commission.
- Rekening dalam format masked.
- Audit trail ringkas.

Action:

- View Detail.
- Suspend.
- Reactivate.
- Revoke.

Tidak ada delete.

## User App

Badge `Founder Chairman` tampil untuk akun Founder Chairman dengan prioritas di atas Founder Platinum pada:

- Dashboard.
- Account/Profile.
- Membership Saya.

## Validasi yang Ditargetkan

- Grant pertama berhasil.
- Founder ID `FCH-001`.
- Membership Platinum aktif.
- Wallet cash/PPOB nol.
- Tidak ada invoice/payment/revenue/bonus saat grant.
- Grant kedua ditolak.
- Founder Chairman menerima bonus dari downline paid saat `ACTIVE`.
- Status `SUSPENDED` dan `REVOKED` menghentikan bonus baru.
- Response tidak memuat nomor rekening penuh.

## Konfirmasi Batasan

- Tidak deploy.
- Tidak migration production.
- Tidak build/upload APK/AAB.
- Tidak mengubah DOKU/Midtrans.
- Tidak mengaktifkan Xendit.
- Tidak mengubah 10 Founder Platinum existing.
