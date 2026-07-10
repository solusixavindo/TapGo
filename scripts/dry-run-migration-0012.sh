#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/apps/backend/prisma/migrations"
DRY_RUN_DB_NAME="${DRY_RUN_DB_NAME:-tapgo_migration_0012_dry_run}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-tapgo}"
PGPASSWORD="${PGPASSWORD:-tapgo_password}"
PGDATABASE="${PGDATABASE:-postgres}"
CONFIRM="${TAPGO_DRY_RUN_CONFIRM:-NO}"
KEEP_DB="${TAPGO_DRY_RUN_KEEP_DB:-NO}"
USE_DOCKER="${TAPGO_DRY_RUN_USE_DOCKER:-NO}"
DOCKER_CONTAINER="${TAPGO_POSTGRES_CONTAINER:-tapgo-postgres}"
BACKUP_FILE="/tmp/${DRY_RUN_DB_NAME}_before_0012.dump"
PSQL_BIN="${PSQL_BIN:-psql}"
CREATEDB_BIN="${CREATEDB_BIN:-createdb}"
DROPDB_BIN="${DROPDB_BIN:-dropdb}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
DRY_RUN_DB_NAME_LOWER="$(printf '%s' "$DRY_RUN_DB_NAME" | tr '[:upper:]' '[:lower:]')"

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

info() {
  printf '[tapgo-dry-run-0012] %s\n' "$1"
}

fail() {
  printf '[tapgo-dry-run-0012] FAIL: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

case "$DRY_RUN_DB_NAME_LOWER" in
  *prod*|*production*|*tapgo_prod*|tapgo)
    fail "Refusing risky database name: ${DRY_RUN_DB_NAME}"
    ;;
esac

if [[ "$DRY_RUN_DB_NAME_LOWER" != *test* && "$DRY_RUN_DB_NAME_LOWER" != *dry* ]]; then
  fail "Dry-run database name must contain 'test' or 'dry': ${DRY_RUN_DB_NAME}"
fi

if [ "$CONFIRM" != "YES" ]; then
  fail "Set TAPGO_DRY_RUN_CONFIRM=YES to allow creating/dropping the local dry-run database"
fi

if [ "$USE_DOCKER" = "YES" ]; then
  require_cmd docker || fail "Docker mode requested but docker CLI was not found"
  docker exec "$DOCKER_CONTAINER" pg_isready -U "$PGUSER" >/dev/null 2>&1 \
    || fail "Docker container ${DOCKER_CONTAINER} is not ready. Run: docker compose -f infra/docker-compose.yml up -d postgres"
else
  missing_tools=()
  for tool in "$PSQL_BIN" "$CREATEDB_BIN" "$DROPDB_BIN" "$PG_DUMP_BIN" "$PG_RESTORE_BIN"; do
    if ! require_cmd "$tool"; then
      missing_tools+=("$tool")
    fi
  done

  if [ "${#missing_tools[@]}" -gt 0 ]; then
    cat >&2 <<EOF
[tapgo-dry-run-0012] FAIL: PostgreSQL client tool(s) not found: ${missing_tools[*]}

Install one of:

macOS with Homebrew:
  brew install libpq
  echo 'export PATH="/opt/homebrew/opt/libpq/bin:\$PATH"' >> ~/.zshrc
  source ~/.zshrc

macOS full PostgreSQL:
  brew install postgresql@16
  echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:\$PATH"' >> ~/.zshrc
  source ~/.zshrc

Ubuntu/Debian:
  sudo apt-get update
  sudo apt-get install -y postgresql-client

Docker mode if tapgo-postgres is running:
  TAPGO_DRY_RUN_USE_DOCKER=YES TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh

Custom binary paths:
  PSQL_BIN=/path/to/psql \\
  CREATEDB_BIN=/path/to/createdb \\
  DROPDB_BIN=/path/to/dropdb \\
  PG_DUMP_BIN=/path/to/pg_dump \\
  PG_RESTORE_BIN=/path/to/pg_restore \\
  TAPGO_DRY_RUN_CONFIRM=YES \\
  ./scripts/dry-run-migration-0012.sh
EOF
    exit 1
  fi
fi

psql_db() {
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec -i "$DOCKER_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DRY_RUN_DB_NAME" "$@"
  else
    "$PSQL_BIN" -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DRY_RUN_DB_NAME" "$@"
  fi
}

psql_maintenance() {
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec -i "$DOCKER_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    "$PSQL_BIN" -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

psql_file() {
  local file="$1"
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec -i "$DOCKER_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$DRY_RUN_DB_NAME" < "$file"
  else
    psql_db -f "$file"
  fi
}

createdb_cmd() {
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec "$DOCKER_CONTAINER" createdb -U "$PGUSER" "$DRY_RUN_DB_NAME"
  else
    "$CREATEDB_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DRY_RUN_DB_NAME"
  fi
}

dropdb_cmd() {
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec "$DOCKER_CONTAINER" dropdb -U "$PGUSER" --if-exists "$DRY_RUN_DB_NAME"
  else
    "$DROPDB_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$DRY_RUN_DB_NAME"
  fi
}

db_exists() {
  psql_maintenance -Atqc "SELECT 1 FROM pg_database WHERE datname = '${DRY_RUN_DB_NAME}'" | grep -q 1
}

reset_dry_run_db() {
  if db_exists; then
    info "Dropping existing dry-run database ${DRY_RUN_DB_NAME}"
    dropdb_cmd
  fi
  info "Creating dry-run database ${DRY_RUN_DB_NAME}"
  createdb_cmd
}

apply_pre_0012_migrations() {
  info "Applying migrations 0001 through 0011"
  local dir
  for dir in \
    0001_init \
    0002_referral_membership \
    0003_referral_wallet_hardening \
    0004_tapgo_business_rules \
    0005_tapgo_package_seed \
    0006_membership_order_foundation \
    0007_membership_activation_ppob \
    0008_sponsor_bonus_direct \
    0009_level_bonus_commission \
    0010_profit_sharing_monthly \
    0011_withdrawal_real_system
  do
    info "Applying ${dir}"
    psql_file "${MIGRATIONS_DIR}/${dir}/migration.sql" >/dev/null
  done
}

seed_legacy_data() {
  info "Seeding legacy pre-0012 wallet data"
  psql_db <<'SQL' >/dev/null
WITH legacy_user AS (
  INSERT INTO "users" ("fullName", "phone", "referral_code")
  VALUES ('Legacy Wallet User', '+628001001001', 'LEGACY001')
  RETURNING "id"
),
legacy_wallet AS (
  INSERT INTO "wallets" ("user_id", "balance", "currency")
  SELECT "id", 157000.00, 'IDR' FROM legacy_user
  RETURNING "id", "user_id"
)
INSERT INTO "wallet_transactions" ("wallet_id", "type", "amount", "reference_type", "reference_id", "metadata")
SELECT "id", 'SPONSOR_BONUS'::"WalletTransactionType", 2000.00, 'LEGACY_SPONSOR', 'legacy-sponsor', '{"dryRun":true}'::jsonb FROM legacy_wallet
UNION ALL
SELECT "id", 'LEVEL_BONUS'::"WalletTransactionType", 50000.00, 'LEGACY_LEVEL', 'legacy-level', '{"dryRun":true}'::jsonb FROM legacy_wallet
UNION ALL
SELECT "id", 'PPOB_BENEFIT'::"WalletTransactionType", 100000.00, 'MEMBERSHIP_ORDER', 'legacy-ppob', '{"packageName":"Silver","dryRun":true}'::jsonb FROM legacy_wallet
UNION ALL
SELECT "id", 'REGISTRATION_BONUS'::"WalletTransactionType", 5000.00, 'BASIC_REGISTRATION', 'legacy-basic', '{"dryRun":true}'::jsonb FROM legacy_wallet;

INSERT INTO "withdrawals" ("wallet_id", "user_id", "amount", "final_amount", "status", "bank_account")
SELECT "id", "user_id", 50000.00, 50000.00, 'PENDING', '{"bankName":"BCA","accountNumber":"000","accountHolderName":"Legacy Wallet User"}'::jsonb
FROM "wallets"
WHERE "user_id" = (SELECT "id" FROM "users" WHERE "referral_code" = 'LEGACY001');
SQL
}

assert_sql() {
  local description="$1"
  local sql="$2"
  local expected="$3"
  local actual
  actual="$(psql_db -Atqc "$sql")"
  if [ "$actual" != "$expected" ]; then
    fail "${description}: expected '${expected}', got '${actual}'"
  fi
  info "PASS: ${description}"
}

backup_pre_0012() {
  info "Creating local backup ${BACKUP_FILE}"
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec "$DOCKER_CONTAINER" pg_dump -U "$PGUSER" --format=custom "$DRY_RUN_DB_NAME" > "$BACKUP_FILE"
    docker exec -i "$DOCKER_CONTAINER" pg_restore --list < "$BACKUP_FILE" >/tmp/tapgo_0012_restore_list.txt
  else
    "$PG_DUMP_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --format=custom --file="$BACKUP_FILE" "$DRY_RUN_DB_NAME"
    "$PG_RESTORE_BIN" --list "$BACKUP_FILE" >/tmp/tapgo_0012_restore_list.txt
  fi
  info "PASS: backup can be listed"
}

apply_0012() {
  info "Applying migration 0012_financial_engine_p1_fix"
  psql_file "${MIGRATIONS_DIR}/0012_financial_engine_p1_fix/migration.sql" >/dev/null
}

validate_after_0012() {
  info "Validating post-0012 state"
  assert_sql "wallets.balance retained" "SELECT balance::text FROM wallets WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001')" "157000.00"
  assert_sql "cash_balance copied from legacy balance" "SELECT cash_balance::text FROM wallets WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001')" "157000.00"
  assert_sql "ppob_balance defaults to zero for legacy wallet" "SELECT ppob_balance::text FROM wallets WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001')" "0.00"
  assert_sql "legacy wallet transactions preserved" "SELECT COUNT(*)::text FROM wallet_transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001'))" "4"
  assert_sql "legacy withdrawal preserved" "SELECT COUNT(*)::text FROM withdrawals WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001')" "1"
  assert_sql "reward_transactions table exists" "SELECT COUNT(*)::text FROM information_schema.tables WHERE table_name='reward_transactions'" "1"
  assert_sql "wallet cash/ppob columns exist" "SELECT COUNT(*)::text FROM information_schema.columns WHERE table_name='wallets' AND column_name IN ('cash_balance','ppob_balance')" "2"
}

restore_backup() {
  info "Simulating rollback by restoring backup"
  dropdb_cmd
  createdb_cmd
  if [ "$USE_DOCKER" = "YES" ]; then
    docker exec -i "$DOCKER_CONTAINER" pg_restore -U "$PGUSER" --dbname "$DRY_RUN_DB_NAME" < "$BACKUP_FILE" >/dev/null
  else
    "$PG_RESTORE_BIN" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --dbname "$DRY_RUN_DB_NAME" "$BACKUP_FILE" >/dev/null
  fi
  assert_sql "restore removes 0012 cash/ppob columns" "SELECT COUNT(*)::text FROM information_schema.columns WHERE table_name='wallets' AND column_name IN ('cash_balance','ppob_balance')" "0"
  assert_sql "restore preserves legacy wallet balance" "SELECT balance::text FROM wallets WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001')" "157000.00"
  assert_sql "restore preserves legacy wallet transactions" "SELECT COUNT(*)::text FROM wallet_transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = (SELECT id FROM users WHERE referral_code='LEGACY001'))" "4"
}

cleanup() {
  if [ "$KEEP_DB" = "YES" ]; then
    info "Keeping dry-run database ${DRY_RUN_DB_NAME}"
  else
    info "Dropping dry-run database ${DRY_RUN_DB_NAME}"
    dropdb_cmd
  fi
}

reset_dry_run_db
apply_pre_0012_migrations
seed_legacy_data
backup_pre_0012
apply_0012
validate_after_0012
restore_backup
cleanup

info "Migration 0012 dry run PASS"
