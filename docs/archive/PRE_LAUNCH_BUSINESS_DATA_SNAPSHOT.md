# Pre-Launch Business Data Snapshot

Tanggal audit: 16 Juni 2026

Scope: snapshot data production read-only jika environment production tersedia.

## Status

Status: **WARNING - snapshot production tidak dieksekusi dari workstation ini**

Alasan:

- Request melarang menyentuh production DB dan cleanup execute.
- Workspace lokal tidak menyediakan kredensial production database yang aman untuk read-only snapshot.
- Audit source code dilakukan penuh, tetapi data production aktual harus diambil dari VPS dengan query read-only atau script audit yang sudah disiapkan.

## Snapshot yang Perlu Diambil di VPS

Jalankan read-only query/script dari VPS setelah memastikan koneksi memakai database production yang benar.

### Command yang Disarankan

```bash
cd /var/www/Tapgo
npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
```

Dry-run hanya boleh membaca dan menyusun rencana, bukan execute. Jangan set `TAPGO_CLEANUP_CONFIRM=YES` kecuali owner sudah menyetujui cleanup.

### Data yang Harus Tercatat

| Area | Data |
| --- | --- |
| Membership | total Basic/Silver/Gold/Platinum, pending/paid/cancelled order |
| Wallet | total cashBalance, total ppobBalance, saldo negatif |
| Ledger | total credit/debit per tipe transaksi |
| Referral | total referral, orphan referral, duplicate genealogy |
| Commission | posted/pending/reversed, duplicate trigger |
| Reward | pending/approved/paid/rejected |
| Withdrawal | pending/approved/rejected/paid, amount melebihi cash |
| Invoice | pending/paid/failed/expired/cancelled |
| Test users | confirmed old test users dan pending invoice/order terkait |

## Query Read-Only Manual

Contoh query, jalankan hanya melalui `psql` dengan user read-only jika tersedia:

```sql
SELECT tier, COUNT(*)
FROM users u
LEFT JOIN memberships m ON m.id = u.membership_id
WHERE u.status <> 'DELETED'
GROUP BY tier
ORDER BY tier;

SELECT
  SUM(balance) AS balance_alias_cash,
  SUM(cash_balance) AS cash_balance,
  SUM(ppob_balance) AS ppob_balance
FROM wallets;

SELECT type, COUNT(*), SUM(amount)
FROM wallet_transactions
GROUP BY type
ORDER BY type;

SELECT status, COUNT(*), SUM(amount)
FROM invoices
GROUP BY status
ORDER BY status;
```

## Kesimpulan

Source engine terlihat siap untuk Closed Testing, tetapi public launch sebaiknya menunggu snapshot production read-only terbaru dari VPS agar tidak ada data test lama, saldo tidak sinkron, atau pending order/invoice yang membingungkan.

