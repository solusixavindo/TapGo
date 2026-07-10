# TapGo P1 Financial Engine VPS Deploy Checklist

Date: 2026-06-09

Scope:

- Prepare safe manual deployment for P1 Financial Engine to `https://api.tapgolion.id`.
- Do not build APK in this stage.
- Do not deploy without backup.
- Do not delete production data.

## A. Pre-Deploy Checklist

Run these checks on the VPS before changing code or database.

```bash
ssh root@<VPS_IP_OR_HOST>
cd /var/www/Tapgo
```

Check process manager:

```bash
pm2 status
pm2 describe tapgo-api
pm2 logs tapgo-api --lines 80
```

Check backend health:

```bash
curl -fsS https://api.tapgolion.id/health
```

Check PostgreSQL:

```bash
systemctl status postgresql --no-pager
pg_isready
```

Check Redis:

```bash
systemctl status redis-server --no-pager
redis-cli ping
```

Check disk space and memory:

```bash
df -h
free -h
du -sh /var/www/Tapgo
```

Record source version:

```bash
git rev-parse HEAD
git status --short
node -v
npm -v
pm2 -v
```

Required pre-deploy confirmations:

- [ ] `pm2 status` shows `tapgo-api` online.
- [ ] `https://api.tapgolion.id/health` returns OK.
- [ ] PostgreSQL is active.
- [ ] Redis is active.
- [ ] Disk has enough free space for database and source backups.
- [ ] Current git commit/source version is recorded.
- [ ] Production backup is completed before `prisma migrate deploy`.

## B. Backup Commands

Set a timestamp first:

```bash
export TAPGO_BACKUP_TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p /var/backups/tapgo
```

Load backend environment if needed:

```bash
set -a
. /var/www/Tapgo/apps/backend/.env
set +a
```

PostgreSQL dump:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="/var/backups/tapgo/tapgo_db_before_p1_financial_${TAPGO_BACKUP_TS}.dump"
```

Optional plain SQL dump for quick inspection:

```bash
pg_dump "$DATABASE_URL" \
  --format=plain \
  --file="/var/backups/tapgo/tapgo_db_before_p1_financial_${TAPGO_BACKUP_TS}.sql"
```

Source backup:

```bash
tar -czf "/var/backups/tapgo/tapgo_source_before_p1_financial_${TAPGO_BACKUP_TS}.tar.gz" \
  -C /var/www Tapgo
```

Verify backup files:

```bash
ls -lh /var/backups/tapgo/*"${TAPGO_BACKUP_TS}"*
pg_restore --list "/var/backups/tapgo/tapgo_db_before_p1_financial_${TAPGO_BACKUP_TS}.dump" >/tmp/tapgo_restore_list_${TAPGO_BACKUP_TS}.txt
tail -20 /tmp/tapgo_restore_list_${TAPGO_BACKUP_TS}.txt
```

## C. Deploy Code

Use one of these source update options.

Option 1, git pull on VPS:

```bash
cd /var/www/Tapgo
git fetch --all --prune
git status --short
git pull --ff-only
```

Option 2, rsync from local machine:

```bash
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  /Users/macbook/Documents/FriTekno/Projects/Tapgo/ \
  root@<VPS_IP_OR_HOST>:/var/www/Tapgo/
```

Install dependencies only if package files changed:

```bash
cd /var/www/Tapgo
npm ci
```

Generate Prisma client:

```bash
npm --workspace apps/backend run db:generate
```

Deploy migration:

```bash
npm --workspace apps/backend run db:deploy
```

Build backend:

```bash
npm --workspace apps/backend run build
```

Restart API:

```bash
pm2 restart tapgo-api --update-env
pm2 save
pm2 logs tapgo-api --lines 80
```

## D. Smoke Test

Health:

```bash
curl -fsS https://api.tapgolion.id/health
```

Optional login test:

```bash
curl -s -X POST https://api.tapgolion.id/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"<USER_PHONE>","password":"<USER_PASSWORD>"}'
```

Wallet endpoint with a sample user token:

```bash
curl -s https://api.tapgolion.id/api/v1/wallet \
  -H "Authorization: Bearer <TOKEN>"
```

Expected wallet fields:

- `balance`
- `cashBalance`
- `ppobBalance`

Admin endpoint protected from normal user:

```bash
curl -i https://api.tapgolion.id/api/v1/admin/dashboard/summary \
  -H "Authorization: Bearer <USER_TOKEN>"
```

Expected:

- `403 Forbidden` for `USER`.
- `200 OK` for `ADMIN` or `SUPER_ADMIN`.

Run packaged smoke test script:

```bash
API_BASE_URL=https://api.tapgolion.id ./scripts/smoke-test-p1-financial.sh
```

With a token:

```bash
API_BASE_URL=https://api.tapgolion.id \
TAPGO_TEST_TOKEN="<TOKEN>" \
./scripts/smoke-test-p1-financial.sh
```

With a normal user token to confirm admin guard:

```bash
API_BASE_URL=https://api.tapgolion.id \
TAPGO_TEST_TOKEN="<USER_TOKEN>" \
TAPGO_EXPECT_ADMIN_FORBIDDEN=1 \
./scripts/smoke-test-p1-financial.sh
```

Withdraw PPOB safety check:

- Do not perform a real withdraw during smoke test unless an approved test account is used.
- Manual check: user with only PPOB and `cashBalance = 0` must fail withdrawal because withdrawal uses cash only.
- Recommended test body for a dedicated staging/UAT account only:

```bash
curl -i -X POST https://api.tapgolion.id/api/v1/wallet/withdrawals \
  -H "Authorization: Bearer <TOKEN_WITH_ONLY_PPOB>" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"bankName":"Bank Central Asia (BCA)","accountNumber":"0000000000","accountHolderName":"TapGo UAT"}'
```

Expected:

- Request rejected due to insufficient cash balance.
- PPOB balance unchanged.

## E. Rollback

Rollback should be coordinated. Prefer restore from backup when migration has been applied and new financial data has been written.

Stop API:

```bash
pm2 stop tapgo-api
```

Restore source backup:

```bash
cd /var/www
mv Tapgo "Tapgo_failed_p1_$(date +%Y%m%d_%H%M%S)"
tar -xzf "/var/backups/tapgo/tapgo_source_before_p1_financial_<TIMESTAMP>.tar.gz" -C /var/www
```

Restore database from custom dump:

```bash
createdb tapgo_restore_tmp
pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" \
  "/var/backups/tapgo/tapgo_db_before_p1_financial_<TIMESTAMP>.dump"
```

Rebuild restored source if needed:

```bash
cd /var/www/Tapgo
npm ci
npm --workspace apps/backend run build
pm2 start tapgo-api --update-env
pm2 save
curl -fsS https://api.tapgolion.id/health
```

Manual schema rollback exists in `MIGRATION_0012_PRODUCTION_REVIEW.md`, but full DB restore is safer if any user activity occurred after deployment.

## F. Deploy Decision Gate

Proceed only when:

- [ ] Backup dump exists and restore list can be read.
- [ ] Source backup exists.
- [ ] Migration 0012 was reviewed.
- [ ] Operator accepts historical PPOB limitation.
- [ ] Rollback operator is available.
- [ ] Smoke test commands are prepared.
- [ ] No APK build is required for this backend-only deployment.
