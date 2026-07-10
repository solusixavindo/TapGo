# Dummy Data Inventory

Tanggal: 17 Juni 2026

Scope: inventaris data dummy/tester/UAT sebelum cleanup final. Dokumen ini tidak menjalankan cleanup dan tidak menyentuh production DB.

## Prinsip Cleanup

1. Backup database production wajib sebelum execute.
2. Cleanup wajib dry-run dulu.
3. Execute hanya dengan explicit owner approval.
4. Jangan hapus record paid/posted/approved tanpa review manual.
5. Jika ada saldo/ledger non-zero, review manual sebelum tindakan.
6. Prefer soft delete/mark DELETED untuk user dibanding hard delete.

## A. KEEP

Data yang harus dipertahankan:

| Data | Alasan |
| --- | --- |
| Super Admin utama | Akses operasional production |
| Admin utama | Operasional approval/report |
| System settings | Konfigurasi aplikasi |
| Membership packages | Business engine production |
| Production configs | Domain/API/payment/env |
| Legal/contact records valid | Compliance |
| Real user dengan transaksi valid | Data production |
| Paid/posted/approved financial ledger | Audit dan kewajiban finansial |

## B. DELETE BEFORE PUBLIC LAUNCH

Kategori yang perlu masuk cleanup allowlist setelah backup dan dry-run:

| Kategori | Contoh / Catatan |
| --- | --- |
| UAT users | Akun tester internal |
| Old test users | Dedi Ganteng, Yeyen Bohay |
| UAT Super Admin | Jika hanya credential testing dan bukan admin utama |
| UAT Admin | Jika hanya credential testing dan bukan admin utama |
| UAT User Test | `080000000003` / user UAT |
| Test A Final | Review ID sebelum execute |
| Smoke Wallet UAT | Review ID sebelum execute |
| UAT A/B/C variants | User skenario referral UAT |
| Dummy membership orders | Pending test order |
| Dummy invoices | Pending/cancelled test invoice |
| Dummy wallet transactions | Hanya dummy, bukan ledger valid |
| Dummy referral relations | Relasi dari user test |
| Dummy rewards/commissions | Reward/commission test |
| Pending Midtrans test orders | Order/invoice belum paid real |

## Confirmed Old Test Users

| User | Status | Catatan |
| --- | --- | --- |
| Dedi Ganteng | CONFIRMED OLD TEST USER | Punya pending order Silver Rp500.000 |
| Yeyen Bohay | CONFIRMED OLD TEST USER | Punya pending order Gold Rp3.000.000 |

Tindakan nanti saat execute:

- Cancel pending membership order.
- Cancel pending invoice.
- Revoke session jika ada.
- Mark user `DELETED` jika tidak punya paid/posted/approved transaction.
- Jangan hapus record paid/posted/approved.

## C. REVIEW MANUAL

Wajib review manual sebelum cleanup:

| Data | Alasan |
| --- | --- |
| User tidak jelas real/tester | Hindari hapus user valid |
| User dengan cashBalance/ppobBalance non-zero | Ada potensi kewajiban saldo |
| User dengan wallet transaction | Ledger audit |
| User dengan paid order/invoice | Data finansial valid |
| User dengan posted commission | Kewajiban komisi |
| User dengan withdrawal approved/paid | Kewajiban finance |
| Referral chain panjang dari data UAT | Bisa terkait user lain |

## D. RESET TO ZERO

Hanya untuk akun dummy yang sudah disetujui owner:

| Saldo | Aturan |
| --- | --- |
| Wallet cash dummy | Reset via reversal/cleanup controlled, bukan edit manual langsung |
| PPOB balance dummy | Reset hanya setelah ledger dummy dicatat/cancel |
| Reward balance dummy | Cancel/reject pending reward dummy |
| Commission dummy | Reverse/cancel jika dummy dan belum paid/posted valid |

## Backup Requirement

Command contoh di VPS, jangan jalankan dari workstation ini:

```bash
cd /var/backups/tapgo
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
pg_dump "$DATABASE_URL" > "tapgo-production-$TIMESTAMP.sql"
tar -czf "tapgo-source-$TIMESTAMP.tar.gz" /var/www/Tapgo
cp /var/www/Tapgo/apps/backend/.env "tapgo-backend-env-$TIMESTAMP.env"
```

## Cleanup Dry-Run Requirement

Command yang boleh dijalankan nanti untuk simulasi:

```bash
cd /var/www/Tapgo
npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
```

Jika ada allowlist user:

```bash
TAPGO_CLEANUP_USER_IDS="uuid1,uuid2" npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
```

## Cleanup Execute Requirement

Command execute hanya boleh setelah backup + approval owner:

```bash
TAPGO_CLEANUP_CONFIRM=YES \
TAPGO_CLEANUP_USER_IDS="uuid1,uuid2" \
npm --workspace apps/backend run cleanup:prelaunch -- --execute
```

## Rollback Plan

Jika cleanup salah:

1. Stop backend sementara jika diperlukan.
2. Restore DB dari dump terakhir.
3. Restart backend.
4. Jalankan health check.
5. Jalankan smoke test user/admin/wallet.

Contoh restore:

```bash
psql "$DATABASE_URL" < /var/backups/tapgo/tapgo-production-YYYYMMDD-HHMMSS.sql
pm2 restart tapgo-api --update-env
curl https://api.tapgolion.id/health
```

## Command yang Tidak Boleh Dijalankan Sekarang

```bash
TAPGO_CLEANUP_CONFIRM=YES ...
npx prisma migrate deploy
pm2 restart tapgo-api
flutter build appbundle
flutter build apk
```

## Cleanup Readiness

Status: **BELUM SIAP EXECUTE**

Alasan:

- Harus ada backup production terbaru.
- Harus ada dry-run terbaru.
- Harus ada owner-confirmed allowlist user IDs.
- Harus dipastikan tidak ada paid/posted/approved ledger yang ikut dihapus.

