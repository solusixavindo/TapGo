# Pre-Launch Data Cleanup Plan

Tanggal: 2026-06-13

Status: PLAN READY, EXECUTION NOT RUN.

Script cleanup dibuat di `scripts/pre-launch-cleanup.ts`.

## Prinsip Cleanup

- Tidak ada data production yang dihapus otomatis.
- Default script adalah `--dry-run`.
- Execute hanya boleh berjalan jika `TAPGO_CLEANUP_CONFIRM=YES`.
- Execute juga wajib memakai `TAPGO_CLEANUP_USER_IDS` sebagai allowlist eksplisit.
- Admin dan Super Admin tidak dihapus oleh script.
- User dengan histori uang tidak dihapus otomatis.
- User dengan saldo `cashBalance` atau `ppobBalance` tidak dihapus otomatis.

## Command Dry Run

```bash
npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
```

## Command Execute Aman

Gunakan hanya setelah backup dan approval manual:

```bash
TAPGO_CLEANUP_CONFIRM=YES TAPGO_CLEANUP_USER_IDS="user-id-1,user-id-2" npm --workspace apps/backend run cleanup:prelaunch -- --execute
```

## Candidate Cleanup

### CONFIRMED OLD TEST USERS

Owner mengonfirmasi dua akun berikut sebagai hasil test lama dari HP lama/APK lama:

| User | Klasifikasi | Pending Data | Rencana Aksi Jika User ID Masuk Allowlist |
| --- | --- | --- | --- |
| Dedi Ganteng | Confirmed old test user | Pending order Silver Rp500.000 | Revoke session, cancel pending membership order, cancel pending invoice/payment, mark user `DELETED` jika tidak ada paid/posted/approved record |
| Yeyen Bohay | Confirmed old test user | Pending order Gold Rp3.000.000 | Revoke session, cancel pending membership order, cancel pending invoice/payment, mark user `DELETED` jika tidak ada paid/posted/approved record |

Catatan: kedua akun ini belum di-cleanup. Script tetap tidak menjalankan execute tanpa `TAPGO_CLEANUP_CONFIRM=YES` dan `TAPGO_CLEANUP_USER_IDS`.

### Dapat Direview Untuk Cleanup

- Akun UAT:
  - `080000000001`
  - `080000000002`
  - `080000000003`
- Akun dengan marker nama/referral/email:
  - UAT
  - test
  - demo
  - dummy
  - sample
- Order/invoice pending lama milik akun test.

### Jangan Dihapus Otomatis

- Akun role `ADMIN`.
- Akun role `SUPER_ADMIN`.
- User dengan invoice `PAID`.
- User dengan membership payment `PAID`.
- User dengan commission/reward/profit sharing.
- User dengan withdrawal.
- User dengan saldo cash/PPOB.
- Audit log.

## Aksi Execute Yang Diizinkan Script

Jika user masuk allowlist dan lolos guard:

1. Revoke session aktif.
2. Cancel pending invoice.
3. Cancel pending membership order.
4. Cancel pending membership payment.
5. Mark user `DELETED` jika tidak ada transaksi final/paid/posted/approved.

Script tidak melakukan physical delete untuk data uang dan tidak menghapus record paid/posted/approved.

## Backup Wajib Sebelum Execute

```bash
pg_dump "$DATABASE_URL" > tapgo_prelaunch_backup_$(date +%Y%m%d_%H%M%S).sql
tar -czf tapgo_source_backup_$(date +%Y%m%d_%H%M%S).tar.gz /var/www/Tapgo
```

## Rollback Konseptual

Jika cleanup execute sudah dijalankan dan perlu rollback:

1. Stop backend sementara.
2. Restore database dump.
3. Restore source jika ada perubahan source.
4. Restart PM2.
5. Jalankan health check.

```bash
pm2 stop tapgo-api
psql "$DATABASE_URL" < tapgo_prelaunch_backup_YYYYMMDD_HHMMSS.sql
pm2 restart tapgo-api --update-env
curl https://api.tapgolion.id/health
```

## Status Lokal

Dry run belum berhasil di mesin lokal karena DB pada `localhost:5433` tidak reachable. Jalankan command dry-run di VPS atau environment yang memiliki akses database production.
