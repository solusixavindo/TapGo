# Production Data Audit Report

Tanggal audit lokal: 2026-06-13

Status: BLOCKED di mesin lokal karena database pada `DATABASE_URL` mengarah ke `localhost:5433` dan tidak reachable. Tidak ada query production yang berhasil dijalankan dari mesin ini, dan tidak ada data production yang diubah.

Script audit read-only sudah dibuat di `scripts/audit-production-data.ts`.

## Scope Audit

Script akan membaca data berikut secara read-only:

- User, role, status, referral code.
- Membership package Basic/Silver/Gold/Platinum.
- Wallet `balance`, `cashBalance`, `ppobBalance`.
- Wallet ledger / wallet transactions.
- Membership orders, invoices, membership payments.
- Referral relation dan referral level.
- Commission.
- Reward transaction.
- Profit sharing period dan distribution.
- Withdrawal.
- Contact message dan delete account request.
- Audit log.
- Prisma migrations.

## Mode Aman

Script hanya memakai operasi baca:

- `count`
- `findMany`
- `aggregate`
- `groupBy`
- read-only migration query

Script tidak memakai:

- `create`
- `update`
- `delete`
- `upsert`
- `truncate`
- migration
- seed

## Command Audit Production

Jalankan di VPS atau mesin yang memang punya akses database production:

```bash
npm --workspace apps/backend run audit:production-data
```

Jika ingin memakai URL database eksplisit tanpa menyimpan ke file:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB" npm --workspace apps/backend run audit:production-data
```

## Hasil Lokal

```text
Can't reach database server at localhost:5433
```

Artinya audit data production belum menghasilkan angka final dari mesin lokal ini.

## Data Yang Akan Diklasifikasikan

### KEEP

- Akun admin operasional production.
- Akun user real yang tidak mengandung marker UAT/test/demo.
- Membership package resmi.
- Ledger wallet, invoice, payment, commission, reward, profit sharing, dan withdrawal dengan status final.
- Audit log, contact message, dan delete account request.

### UAT / Dummy / Tester Candidate

- Nomor UAT resmi:
  - `080000000001`
  - `080000000002`
  - `080000000003`
- Confirmed old test users dari owner:
  - Dedi Ganteng = confirmed old test user, pending order Silver Rp500.000.
  - Yeyen Bohay = confirmed old test user, pending order Gold Rp3.000.000.
- Nama/email/referral code yang mengandung marker:
  - `uat`
  - `test`
  - `tester`
  - `demo`
  - `dummy`
  - `sample`
- Order/invoice pending lama dari user kandidat.

### Review Manual

- User yang memiliki histori keuangan.
- User dengan saldo cash/PPOB.
- Reward/commission/profit sharing yang sudah masuk proses approval atau paid.

## Catatan PII

Report yang dibuat script melakukan masking nomor HP dan email. Token, password, server key, dan secret tidak ditampilkan.

## Kesimpulan

Audit production data belum dapat dinyatakan selesai dari mesin lokal ini karena koneksi DB production tidak tersedia. Script sudah siap dijalankan secara read-only di VPS atau environment yang memiliki akses database.

## Update Owner 2026-06-13

Owner mengonfirmasi bahwa dua akun berikut adalah hasil test lama dari HP lama/APK lama dan boleh dikategorikan sebagai `OLD TEST USER / DUMMY TEST USER`:

| User | Klasifikasi | Data Terkait Dari Audit VPS | Status Cleanup |
| --- | --- | --- | --- |
| Dedi Ganteng | Confirmed old test user | Pending order Silver Rp500.000 | Belum dieksekusi |
| Yeyen Bohay | Confirmed old test user | Pending order Gold Rp3.000.000 | Belum dieksekusi |

Catatan: cleanup tetap harus lewat dry-run, backup, allowlist user ID, dan `TAPGO_CLEANUP_CONFIRM=YES`. Tidak ada delete/cleanup execute yang dijalankan dari update ini.
