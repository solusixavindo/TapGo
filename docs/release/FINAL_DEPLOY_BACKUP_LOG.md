# TapGo Final Deploy Backup Log

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`  
Scope: P1 Financial Engine backend deployment preparation

## Status Eksekusi

Status: NOT EXECUTED FROM CODEX SESSION.

Reason:

- This workspace does not contain VPS SSH credentials or production database credentials.
- Production backup must be executed directly on the VPS by the operator before deployment.
- APK build must wait until backup, backend deploy, and smoke test PASS.

## Backup Log Fields

Fill these fields after running backup on VPS:

| Item | Value |
| --- | --- |
| Backup operator | |
| VPS host/IP | |
| Backup timestamp | |
| Source version before deploy | |
| PM2 status before deploy | |
| Database dump path | |
| Source backup path | |
| Backend `.env` backup path | |
| Restore list verified | YES / NO |
| Health before deploy | PASS / FAIL |

## Pre-Backup Commands

Run on VPS:

```bash
ssh root@<VPS_IP_OR_HOST>
cd /var/www/Tapgo

pm2 status
pm2 describe tapgo-api
curl -fsS https://api.tapgolion.id/health

git rev-parse HEAD || true
git status --short || true
node -v
npm -v
pm2 -v

systemctl status postgresql --no-pager
pg_isready
systemctl status redis-server --no-pager || true
redis-cli ping || true
df -h
free -h
```

## Backup Commands

Set timestamp:

```bash
export TAPGO_BACKUP_TS="$(date +%Y%m%d_%H%M%S)"
mkdir -p /var/backups/tapgo
```

Backup backend `.env`:

```bash
cp /var/www/Tapgo/apps/backend/.env \
  "/var/backups/tapgo/backend_env_before_p1_financial_${TAPGO_BACKUP_TS}.env"
chmod 600 "/var/backups/tapgo/backend_env_before_p1_financial_${TAPGO_BACKUP_TS}.env"
```

Load backend env:

```bash
set -a
. /var/www/Tapgo/apps/backend/.env
set +a
```

Backup PostgreSQL database:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file="/var/backups/tapgo/tapgo_db_before_p1_financial_${TAPGO_BACKUP_TS}.dump"
```

Optional plain SQL backup:

```bash
pg_dump "$DATABASE_URL" \
  --format=plain \
  --file="/var/backups/tapgo/tapgo_db_before_p1_financial_${TAPGO_BACKUP_TS}.sql"
```

Backup source:

```bash
tar -czf "/var/backups/tapgo/tapgo_source_before_p1_financial_${TAPGO_BACKUP_TS}.tar.gz" \
  -C /var/www Tapgo
```

Verify backup:

```bash
ls -lh /var/backups/tapgo/*"${TAPGO_BACKUP_TS}"*
pg_restore --list "/var/backups/tapgo/tapgo_db_before_p1_financial_${TAPGO_BACKUP_TS}.dump" \
  >/tmp/tapgo_restore_list_${TAPGO_BACKUP_TS}.txt
tail -20 /tmp/tapgo_restore_list_${TAPGO_BACKUP_TS}.txt
```

## Deploy Commands After Backup

Run only after backup verification succeeds:

```bash
cd /var/www/Tapgo
git fetch --all --prune
git status --short
git pull --ff-only

npm ci
npm --workspace apps/backend run db:generate
npm --workspace apps/backend run db:deploy
npm --workspace apps/backend run build

pm2 restart tapgo-api --update-env
pm2 save
pm2 status
pm2 logs tapgo-api --lines 80
curl -fsS https://api.tapgolion.id/health
```

Expected migration:

- `0012_financial_engine_p1_fix` applied by `prisma migrate deploy`.

## Rollback Commands

Use rollback only if migration/deploy/smoke test fails and operator decides restore is required.

Stop API:

```bash
pm2 stop tapgo-api
```

Restore source:

```bash
cd /var/www
mv Tapgo "Tapgo_failed_p1_$(date +%Y%m%d_%H%M%S)"
tar -xzf "/var/backups/tapgo/tapgo_source_before_p1_financial_<TIMESTAMP>.tar.gz" -C /var/www
```

Restore backend `.env`:

```bash
cp "/var/backups/tapgo/backend_env_before_p1_financial_<TIMESTAMP>.env" \
  /var/www/Tapgo/apps/backend/.env
chmod 600 /var/www/Tapgo/apps/backend/.env
```

Restore database:

```bash
set -a
. /var/www/Tapgo/apps/backend/.env
set +a

pg_restore --clean --if-exists --no-owner \
  --dbname "$DATABASE_URL" \
  "/var/backups/tapgo/tapgo_db_before_p1_financial_<TIMESTAMP>.dump"
```

Restart restored API:

```bash
cd /var/www/Tapgo
npm ci
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
curl -fsS https://api.tapgolion.id/health
```

## Deployment Gate

Do not continue if any item fails:

- [ ] DB backup exists.
- [ ] Source backup exists.
- [ ] Backend `.env` backup exists.
- [ ] `pg_restore --list` can read backup.
- [ ] Health endpoint OK before deploy.
- [ ] Migration deploy succeeds.
- [ ] Backend build succeeds.
- [ ] PM2 restart succeeds.
- [ ] Smoke test PASS.
