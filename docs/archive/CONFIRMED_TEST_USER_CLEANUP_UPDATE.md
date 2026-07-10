# Confirmed Test User Cleanup Update

Tanggal: 2026-06-13

Status: DOCUMENTED ONLY. Cleanup execute belum dijalankan.

## Confirmed Old Test Users

Owner mengonfirmasi akun berikut sebagai hasil test lama dari HP lama/APK lama:

| User | Klasifikasi | Pending Data Dari Audit VPS |
| --- | --- | --- |
| Dedi Ganteng | OLD TEST USER / DUMMY TEST USER | Pending order Silver Rp500.000 |
| Yeyen Bohay | OLD TEST USER / DUMMY TEST USER | Pending order Gold Rp3.000.000 |

## Tindakan Cleanup Yang Disiapkan

Jika user ID Dedi Ganteng dan/atau Yeyen Bohay dimasukkan ke `TAPGO_CLEANUP_USER_IDS`, script `scripts/pre-launch-cleanup.ts` menyiapkan aksi berikut:

1. Revoke session aktif jika ada.
2. Cancel pending membership order.
3. Cancel pending invoice.
4. Cancel pending membership payment.
5. Mark user sebagai `DELETED` jika tidak ada transaksi final/paid/posted/approved.

## Data Yang Tidak Akan Dihapus

Script tidak menghapus:

- Record `PAID`.
- Record `POSTED`.
- Record `APPROVED`.
- Commission yang sudah posted.
- Reward yang sudah approved/paid.
- Withdrawal yang sudah approved/paid.
- Invoice/payment yang sudah paid/authorized/refunded.
- Audit log.
- Data admin/super admin.

## Guard Execute

Cleanup tetap tidak bisa execute tanpa dua syarat:

```bash
TAPGO_CLEANUP_CONFIRM=YES
TAPGO_CLEANUP_USER_IDS="user-id-dedi,user-id-yeyen"
```

Command execute nanti, setelah backup dan approval manual:

```bash
TAPGO_CLEANUP_CONFIRM=YES TAPGO_CLEANUP_USER_IDS="user-id-dedi,user-id-yeyen" npm --workspace apps/backend run cleanup:prelaunch -- --execute
```

Command di atas belum dijalankan.

## Risiko

| Risiko | Mitigasi |
| --- | --- |
| Salah user ID masuk allowlist | Wajib cocokkan nama, nomor HP masked/unmasked di VPS, dan pending order sebelum execute. |
| User ternyata punya transaksi final | Script abort jika menemukan paid/posted/approved financial record. |
| Cleanup membuat akun tidak bisa login | Memang tujuan cleanup untuk akun test lama; rollback memakai backup DB jika diperlukan. |
| Pending invoice/order berubah menjadi cancelled | Sesuai cleanup plan untuk test lama; tidak dilakukan pada user real. |

## Rollback Requirement

Sebelum execute wajib ada backup:

```bash
pg_dump "$DATABASE_URL" > tapgo_prelaunch_backup_$(date +%Y%m%d_%H%M%S).sql
tar -czf tapgo_source_backup_$(date +%Y%m%d_%H%M%S).tar.gz /var/www/Tapgo
```

Rollback konseptual:

```bash
pm2 stop tapgo-api
psql "$DATABASE_URL" < tapgo_prelaunch_backup_YYYYMMDD_HHMMSS.sql
pm2 restart tapgo-api --update-env
curl https://api.tapgolion.id/health
```

## Status

- Dedi Ganteng: confirmed old test user, cleanup belum dijalankan.
- Yeyen Bohay: confirmed old test user, cleanup belum dijalankan.
- Cleanup script: tetap dry-run default dan execute terkunci konfirmasi + allowlist.

## Validasi Lokal

| Command | Result | Catatan |
| --- | --- | --- |
| `npm --workspace apps/backend run build` | PASS | Backend TypeScript build berhasil. |
| `npm --workspace apps/backend run cleanup:prelaunch -- --dry-run` | BLOCKED LOKAL | Database pada `localhost:5433` tidak reachable dari mesin lokal ini. Tidak ada perubahan database. |

Dry-run perlu dijalankan ulang di VPS/environment yang memiliki akses database production:

```bash
npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
```
