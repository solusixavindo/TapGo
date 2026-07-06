# Final Production Deploy Steps

Status: manual execution guide only. Dokumen ini tidak menjalankan deploy, tidak menjalankan migration production, dan tidak menampilkan credential.

## Production Readiness Summary

| Area | Status | Evidence |
| --- | --- | --- |
| Backend health endpoint | READY | `GET /health` dan `GET /api/v1/health` tersedia. |
| Logging safety | READY | Pino logger memakai redaction untuk authorization, cookie, token, signature, DOKU secret/API key, dan password. |
| DOKU primary gateway | READY FOR DEPLOY | Checkout mode dikunci melalui env dan endpoint canonical tersedia. |
| DOKU webhook | READY FOR UAT | `POST /api/v1/webhooks/doku` memakai raw body, signature validation, status mapping, dan idempotency. |
| Midtrans fallback | PRESERVED | Midtrans tetap ada sebagai secondary/fallback. |
| Xendit | NOT USED | Tidak masuk TapGo v1.0. |

## Required Production Env Checklist

Jangan menulis nilai credential di dokumen, chat, atau Git.

```text
NODE_ENV=production
DATABASE_URL=<production-postgres-url>
REDIS_URL=<production-redis-url-if-used>

DOKU_ENABLED=true
DOKU_INTEGRATION_MODE=checkout
DOKU_ENVIRONMENT=production
DOKU_BASE_URL=https://api.doku.com
DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku
DOKU_CLIENT_ID=<from-doku-dashboard>
DOKU_SECRET_KEY=<from-doku-dashboard>
DOKU_API_KEY=<from-doku-dashboard-if-required>
DOKU_PUBLIC_KEY=<from-doku-dashboard-if-required>
DOKU_WEBHOOK_SECRET=<from-doku-dashboard-if-required>
```

Midtrans env boleh tetap tersedia untuk fallback, tetapi jangan menjadikan Midtrans primary pada TapGo v1.0.

## Pre-Deploy Manual Checklist

1. SSH ke VPS.
2. Catat commit/source version saat ini.
3. Cek PM2 status.
4. Cek health backend saat ini.
5. Cek disk space.
6. Cek PostgreSQL.
7. Cek Redis jika digunakan.
8. Backup database.
9. Backup source.
10. Backup backend `.env`.
11. Pastikan DOKU env production lengkap di server.
12. Pastikan tidak ada Xendit env/flow yang diwajibkan.

## Backup Commands

Sesuaikan path jika struktur VPS berbeda.

```bash
export TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p /var/backups/tapgo/$TS

pm2 status > /var/backups/tapgo/$TS/pm2-status-before.txt
git -C /var/www/Tapgo rev-parse HEAD > /var/backups/tapgo/$TS/source-version-before.txt || true
pg_dump "$DATABASE_URL" > /var/backups/tapgo/$TS/tapgo-production.sql
tar -czf /var/backups/tapgo/$TS/tapgo-source.tar.gz /var/www/Tapgo
cp /var/www/Tapgo/apps/backend/.env /var/backups/tapgo/$TS/backend.env
```

## Deploy Steps

Jalankan hanya setelah backup berhasil.

```bash
cd /var/www/Tapgo
git pull --ff-only
npm ci
npm --workspace apps/backend run db:generate
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
```

Catatan:

- Jangan jalankan `prisma migrate deploy` kecuali owner memberi instruksi eksplisit untuk migration production.
- Jika tidak ada migration baru, deploy backend cukup build/restart.
- Jangan build APK/AAB dalam langkah deploy backend.

## Health Check

```bash
curl -fsS https://api.tapgolion.id/health
curl -fsS https://api.tapgolion.id/api/v1/health
pm2 logs tapgo-api --lines 100
```

Expected:

- Response `success=true`.
- `status=ok`.
- Tidak ada error boot.
- Tidak ada credential muncul di log.

## DOKU Post-Deploy Check

1. Pastikan dashboard DOKU memakai webhook URL:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

2. Create payment untuk order test terkontrol.
3. Pastikan response aman berisi `paymentUrl` atau `redirectUrl`.
4. Jangan bayar sampai nominal dan invoice disetujui owner.

## Rollback Plan

Jika backend gagal start:

```bash
cd /var/www/Tapgo
tar -xzf /var/backups/tapgo/$TS/tapgo-source.tar.gz -C /
cp /var/backups/tapgo/$TS/backend.env /var/www/Tapgo/apps/backend/.env
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
curl -fsS https://api.tapgolion.id/health
```

Jika data rusak:

1. Stop traffic payment sementara.
2. Jangan restore database otomatis tanpa owner approval.
3. Restore database dari `/var/backups/tapgo/$TS/tapgo-production.sql` hanya jika disetujui.
4. Simpan incident log dan payment reference yang terdampak.

## Go / No-Go

| Target | Decision |
| --- | --- |
| Manual backend deploy | GO dengan backup dan owner approval |
| Migration production | NO-GO tanpa instruksi eksplisit |
| DOKU webhook UAT | GO setelah deploy |
| Google Play final build/upload | NO-GO sampai payment UAT PASS |

