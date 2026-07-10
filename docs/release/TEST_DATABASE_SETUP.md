# TapGo Test Database Setup

Date: 2026-06-11

Purpose:

- Provide a reliable local/staging database setup for TapGo backend integration tests.
- Avoid accidental production database usage.
- Unblock validation before VPS deployment.

## 1. Required Connection String

Use a dedicated test database only:

```bash
export TAPGO_TEST_DATABASE_URL="postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public"
export DATABASE_URL="$TAPGO_TEST_DATABASE_URL"
```

The database name must contain `test`.

Never point `TAPGO_TEST_DATABASE_URL` to production.

## 2. Option A: Docker Compose Test Database

This is the recommended local setup.

Start Docker Desktop first, then run:

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis
docker ps
```

Expected containers:

- `tapgo-postgres`
- `tapgo-redis`

Check PostgreSQL:

```bash
docker exec tapgo-postgres pg_isready -U tapgo -d tapgo
```

Create/recreate test DB:

```bash
docker exec tapgo-postgres dropdb -U tapgo --if-exists tapgo_test
docker exec tapgo-postgres createdb -U tapgo tapgo_test
```

Run migrations:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm --workspace apps/backend run db:deploy
```

Run integration tests:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm --workspace apps/backend run test
```

Target:

- all backend tests PASS,
- 0 skipped,
- reward admin lifecycle tests PASS,
- financial admin report tests PASS.

## 3. Option B: Local PostgreSQL Without Docker

Install PostgreSQL client/server.

macOS with Homebrew:

```bash
brew install postgresql@16
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
brew services start postgresql@16
```

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-client
sudo systemctl enable --now postgresql
```

Create role and DB:

```bash
createuser tapgo --createdb --login
createdb -O tapgo tapgo_test
```

If password auth is required:

```bash
psql -d postgres -c "ALTER USER tapgo WITH PASSWORD 'tapgo_password';"
```

If local PostgreSQL uses port `5432`, either:

- change the connection string to port `5432`, or
- configure PostgreSQL to listen on `5433`.

Run migrations/tests with the matching port:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5432/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5432/tapgo_test?schema=public \
npm --workspace apps/backend run db:deploy

TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5432/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5432/tapgo_test?schema=public \
npm --workspace apps/backend run test
```

## 4. Migration Dry Run Setup

The dry-run script requires PostgreSQL client tools:

- `psql`
- `createdb`
- `dropdb`
- `pg_dump`
- `pg_restore`

Install only client tools if PostgreSQL server is already in Docker.

macOS:

```bash
brew install libpq
echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y postgresql-client
```

Run dry-run with local PostgreSQL client tools:

```bash
TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh
```

Run dry-run with Docker PostgreSQL tools if Docker is active:

```bash
TAPGO_DRY_RUN_USE_DOCKER=YES TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh
```

With custom local DB config:

```bash
PGHOST=localhost \
PGPORT=5433 \
PGUSER=tapgo \
PGPASSWORD=tapgo_password \
DRY_RUN_DB_NAME=tapgo_migration_0012_dry_run \
TAPGO_DRY_RUN_CONFIRM=YES \
./scripts/dry-run-migration-0012.sh
```

## 5. Troubleshooting Port 5433

Check if anything is listening:

```bash
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

Check Docker port mapping:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

If `localhost:5433` is not reachable:

```bash
docker compose -f infra/docker-compose.yml up -d postgres
docker exec tapgo-postgres pg_isready -U tapgo -d tapgo
```

If Docker daemon is not running:

- Open Docker Desktop on macOS.
- Wait until Docker says it is running.
- Retry `docker compose -f infra/docker-compose.yml up -d postgres redis`.

If `psql` is missing but Docker is running:

```bash
docker exec -it tapgo-postgres psql -U tapgo -d tapgo
```

For migration dry-run, Docker mode can use `pg_dump` and `pg_restore` inside `tapgo-postgres`; local PostgreSQL client tools are only required for non-Docker mode.

## 6. Targeted Admin/Financial Tests

Run targeted tests from `apps/backend` so `apps/backend/vitest.config.ts` is loaded.
That config disables file parallelism for shared integration DB safety.

```bash
cd apps/backend
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npx vitest run \
  tests/admin-console/adminConsole.integration.test.ts \
  tests/business-engine/ppobWalletSeparation.integration.test.ts \
  tests/business-engine/rewardEngineFinal.integration.test.ts \
  tests/business-engine/profitSharingFinal.integration.test.ts \
  tests/business-engine/upgradeFinancialFlow.integration.test.ts \
  tests/business-engine/refundReversalAudit.integration.test.ts
```

## 7. Commands To Run Before VPS Deploy

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npm --workspace apps/backend run test

npm --workspace apps/backend run build

DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npx prisma validate --schema apps/backend/prisma/schema.prisma

DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npx prisma generate --schema apps/backend/prisma/schema.prisma

TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh
```

Do not deploy until all commands pass.
