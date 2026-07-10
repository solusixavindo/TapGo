# Migration 0012 Production Review

Date: 2026-06-09

Migration reviewed:

- `apps/backend/prisma/migrations/0012_financial_engine_p1_fix/migration.sql`

## Apa Yang Berubah

Migration 0012 menambahkan struktur finansial baru untuk memisahkan saldo cash dan saldo PPOB.

Perubahan:

- Menambah enum `RewardTransactionStatus`:
  - `PENDING`
  - `APPROVED`
  - `PAID`
  - `REJECTED`
- Menambah kolom di `wallets`:
  - `cash_balance DECIMAL(14,2) NOT NULL DEFAULT 0`
  - `ppob_balance DECIMAL(14,2) NOT NULL DEFAULT 0`
- Mengisi `cash_balance` dari nilai `balance` lama:
  - `cash_balance = balance`
  - hanya untuk row existing dengan `balance <> 0`
- Menambah kolom formula di `profit_sharing_periods`:
  - `net_profit_amount`
  - `silver_allocation`
  - `gold_allocation`
  - `platinum_allocation`
  - `retained_amount`
- Mengisi `net_profit_amount` historis dari `total_pool_amount` sebagai compatibility placeholder.
- Membuat tabel baru `reward_transactions`.
- Membuat index dan foreign key untuk `reward_transactions`.

## Production Safety

| Check | Result |
| --- | --- |
| Drop table | Tidak ada |
| Delete data | Tidak ada |
| Reset data | Tidak ada |
| Rename destructive | Tidak ada |
| Existing wallet transaction readable | Aman |
| Existing `wallets.balance` retained | Aman |
| API lama yang membaca `balance` | Tetap ada |
| Withdrawal existing | Tetap mengacu wallet dan nominal withdrawal existing |
| New PPOB balance for historical rows | Default Rp0 |

## Mapping Data Existing

Existing wallet rows:

- `balance` lama tidak diubah.
- `cash_balance` baru disalin dari `balance`.
- `ppob_balance` baru default `0`.

Interpretasi:

- Saldo historis dianggap cash wallet karena sebelum migration belum ada pemisahan cash/PPOB yang reliable.
- PPOB historis tidak direkonstruksi otomatis dari ledger supaya tidak berisiko double-count atau salah memindahkan saldo.

## Risiko

### P1 Risk: Historical PPOB Not Reclassified

Jika sebelum migration ada saldo `balance` yang sebenarnya berasal dari PPOB benefit, migration akan menyalinnya ke `cash_balance`.

Alasan dipilih:

- Ini pilihan paling aman agar saldo user existing tidak hilang.
- Reclassification historis butuh audit ledger manual agar tidak salah memindahkan saldo.

Mitigasi:

- Jalankan query audit ledger PPOB sebelum production migration.
- Jika ingin reclass PPOB historis, lakukan migration terpisah setelah bisnis menyetujui formula rekonsiliasi.

### P2 Risk: Rollback Needs Coordination

Karena kode baru membaca `cash_balance`, rollback DB tanpa rollback app/backend akan membuat runtime error.

Mitigasi:

- Rollback harus satu paket: backend code rollback + DB rollback.
- Backup wajib sebelum migration.

## Strategi Backup

Sebelum migration production:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="tapgo_backup_before_0012_$(date +%Y%m%d_%H%M%S).dump"
```

Backup tabel finansial cepat:

```sql
CREATE TABLE wallets_backup_before_0012 AS SELECT * FROM wallets;
CREATE TABLE wallet_transactions_backup_before_0012 AS SELECT * FROM wallet_transactions;
CREATE TABLE commissions_backup_before_0012 AS SELECT * FROM commissions;
CREATE TABLE profit_sharing_periods_backup_before_0012 AS SELECT * FROM profit_sharing_periods;
```

## Command Deploy Migration

Production/UAT VPS command:

```bash
cd /var/www/Tapgo
git pull
npm install
npm --workspace apps/backend run build
npm --workspace apps/backend run db:generate
npm --workspace apps/backend run db:deploy
pm2 restart tapgo-api --update-env
pm2 save
curl -fsS https://api.tapgolion.id/health
```

Direct Prisma command if needed:

```bash
DATABASE_URL="postgresql://..." npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
```

## Post-Migration Verification

```sql
SELECT COUNT(*) FROM wallets WHERE cash_balance IS NULL OR ppob_balance IS NULL;
SELECT COUNT(*) FROM wallets WHERE balance <> cash_balance;
SELECT COUNT(*) FROM reward_transactions;
SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets';
```

Expected after migration:

- No null `cash_balance`.
- No null `ppob_balance`.
- `balance = cash_balance` for existing rows unless later code changes cash.
- `reward_transactions` exists and can be queried.

## Manual Rollback Strategy

Use only if:

- migration has been applied,
- backend code has not started depending on new data, or backend is rolled back first,
- production backup is available.

Manual rollback SQL:

```sql
ALTER TABLE reward_transactions DROP CONSTRAINT IF EXISTS reward_transactions_wallet_transaction_id_fkey;
ALTER TABLE reward_transactions DROP CONSTRAINT IF EXISTS reward_transactions_wallet_id_fkey;
ALTER TABLE reward_transactions DROP CONSTRAINT IF EXISTS reward_transactions_user_id_fkey;

DROP TABLE IF EXISTS reward_transactions;
DROP TYPE IF EXISTS "RewardTransactionStatus";

ALTER TABLE profit_sharing_periods
  DROP COLUMN IF EXISTS retained_amount,
  DROP COLUMN IF EXISTS platinum_allocation,
  DROP COLUMN IF EXISTS gold_allocation,
  DROP COLUMN IF EXISTS silver_allocation,
  DROP COLUMN IF EXISTS net_profit_amount;

ALTER TABLE wallets
  DROP COLUMN IF EXISTS ppob_balance,
  DROP COLUMN IF EXISTS cash_balance;
```

If data has already been written after migration, prefer restore from backup instead of manual rollback.

## Recommendation

Migration is structurally safe for UAT production deployment after backup.

Important: historical PPOB reclassification is intentionally not done in this migration. Treat historical `balance` as cash unless a separate reconciliation project is approved.
