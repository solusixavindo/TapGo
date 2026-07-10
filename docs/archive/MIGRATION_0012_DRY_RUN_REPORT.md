# TapGo Migration 0012 Dry Run Report

Date: 2026-06-11

Migration:

- `apps/backend/prisma/migrations/0012_financial_engine_p1_fix/migration.sql`

## Blocker Sebelumnya

Status sebelumnya: BLOCKED.

Penyebab:

- PostgreSQL client tools (`psql`, `createdb`, `dropdb`, `pg_dump`, `pg_restore`) tidak tersedia di PATH macOS.
- Docker daemon belum aktif, sehingga tools PostgreSQL di container `tapgo-postgres` belum bisa dipakai.

Perbaikan:

- `scripts/dry-run-migration-0012.sh` sekarang melakukan dependency check di awal.
- Script memberikan instruksi install PostgreSQL client:
  - macOS: `brew install libpq` atau `brew install postgresql@16`
  - Ubuntu/Debian: `sudo apt-get install -y postgresql-client`
- Script mendukung Docker mode:

```bash
TAPGO_DRY_RUN_USE_DOCKER=YES TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh
```

- Script tetap mendukung non-Docker local PostgreSQL mode.
- Script dibuat kompatibel dengan Bash bawaan macOS.

## Skenario Dry Run

Script:

- `scripts/dry-run-migration-0012.sh`

Flow yang dijalankan:

1. Create temporary database `tapgo_migration_0012_dry_run`.
2. Apply migrations `0001_init` through `0011_withdrawal_real_system`.
3. Seed legacy data:
   - old wallet `balance`,
   - sponsor bonus wallet transaction,
   - level bonus wallet transaction,
   - `PPOB_BENEFIT` wallet transaction,
   - `REGISTRATION_BONUS` wallet transaction,
   - pending withdrawal,
   - active legacy user.
4. Backup local dry-run database before migration 0012.
5. Apply migration `0012_financial_engine_p1_fix`.
6. Validate:
   - `wallets.balance` retained,
   - `wallets.cash_balance` copied from old `balance`,
   - `wallets.ppob_balance` defaults to `0`,
   - old wallet transactions remain readable,
   - old withdrawal remains readable,
   - `reward_transactions` exists.
7. Restore backup locally.
8. Validate restored DB returns to pre-0012 shape.
9. Drop temporary dry-run DB.

## Command Yang Berhasil

```bash
TAPGO_DRY_RUN_USE_DOCKER=YES TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh
```

Optional local PostgreSQL command:

```bash
PGHOST=localhost \
PGPORT=5433 \
PGUSER=tapgo \
PGPASSWORD=tapgo_password \
DRY_RUN_DB_NAME=tapgo_migration_0012_dry_run \
TAPGO_DRY_RUN_CONFIRM=YES \
./scripts/dry-run-migration-0012.sh
```

## Hasil Migration

Status: PASS.

Observed PASS checks:

- `PASS: backup can be listed`
- `PASS: wallets.balance retained`
- `PASS: cash_balance copied from legacy balance`
- `PASS: ppob_balance defaults to zero for legacy wallet`
- `PASS: legacy wallet transactions preserved`
- `PASS: legacy withdrawal preserved`
- `PASS: reward_transactions table exists`
- `PASS: wallet cash/ppob columns exist`
- `Migration 0012 dry run PASS`

## Hasil Restore

Status: PASS.

Restore simulation:

- Backup dibuat dengan `pg_dump --format=custom`.
- Database dry-run di-drop dan dibuat ulang.
- Backup direstore dengan `pg_restore`.
- State pre-0012 tervalidasi.

Observed PASS checks:

- `PASS: restore removes 0012 cash/ppob columns`
- `PASS: restore preserves legacy wallet balance`
- `PASS: restore preserves legacy wallet transactions`

## Production Safety Notes

Migration 0012 remains non-destructive based on dry-run:

- Does not drop existing wallet data.
- Keeps `wallets.balance`.
- Copies legacy `balance` into `cash_balance`.
- Initializes `ppob_balance` as `0` for existing wallets.
- Preserves old wallet transactions.
- Preserves old withdrawals.
- Adds `reward_transactions`.

Production deployment must still take a database backup before `prisma migrate deploy`.

## Recommendation

Migration 0012 is ready for manual VPS deployment after production backup.

Do not run seed/demo commands on production.
