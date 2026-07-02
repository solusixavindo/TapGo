# Production Infrastructure Audit

Status dokumen: preparation only. Tidak ada deploy, tidak ada migration production, dan tidak ada perubahan VPS yang dijalankan dari dokumen ini.

## Scope

Audit kesiapan operasional untuk backend TapGo production di `https://api.tapgolion.id` dengan DOKU sebagai primary gateway dan Midtrans sebagai secondary/fallback.

## Infrastructure Matrix

| Area | Expected | Status | Action Before Launch |
| --- | --- | --- | --- |
| Backend health | `GET /health` responsif | Ready for manual smoke test | Jalankan curl setelah deploy manual. |
| PostgreSQL | Service aktif, backup tersedia | Manual verification required | Cek service, koneksi, disk, dan backup. |
| Redis | Service aktif untuk cache/rate limit/session flow jika digunakan | Manual verification required | Cek ping Redis dan memory. |
| Logging | PM2 logs, redaction aktif | Ready with caution | Pastikan log tidak menyimpan secret/payment signature. |
| Backup | DB dump, source backup, `.env` backup | Required before deploy | Wajib sebelum migration/deploy apa pun. |
| Monitoring | Health check, PM2 status, disk usage, logs | Manual verification required | Buat jadwal monitoring harian selama UAT. |
| Env production | DOKU env server-side only | Manual verification required | Jangan cat secret di dokumen/chat. |
| Webhook URL | `https://api.tapgolion.id/api/v1/webhooks/doku` | Ready | Set di dashboard DOKU. |
| Rollback | Restore DB/source + PM2 restart | Prepared | Latih restore di staging/local sebelum public launch. |

## Pre-Deploy Checks

```bash
pm2 status
curl -fsS https://api.tapgolion.id/health
df -h
free -m || true
systemctl status postgresql || true
systemctl status redis || true
```

## Backup Commands

Gunakan timestamp dan simpan di folder backup non-public.

```bash
export TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p /var/backups/tapgo/$TS
pg_dump "$DATABASE_URL" > /var/backups/tapgo/$TS/tapgo-production.sql
tar -czf /var/backups/tapgo/$TS/tapgo-source.tar.gz /var/www/Tapgo
cp /var/www/Tapgo/apps/backend/.env /var/backups/tapgo/$TS/backend.env
pm2 status > /var/backups/tapgo/$TS/pm2-status.txt
```

## Production Env Checklist

- `NODE_ENV=production`
- `DATABASE_URL` production benar.
- `REDIS_URL` production benar jika dipakai.
- `DOKU_ENABLED=true`
- `DOKU_INTEGRATION_MODE=checkout`
- `DOKU_ENVIRONMENT=production`
- `DOKU_BASE_URL=https://api.doku.com`
- `DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku`
- Midtrans env boleh tetap tersedia sebagai fallback.
- Tidak ada Xendit env yang diperlukan untuk TapGo v1.0.

## Rollback Plan

1. Stop/restart aplikasi hanya setelah backup ada.
2. Jika deploy gagal sebelum migration: restore source backup dan `pm2 restart`.
3. Jika deploy gagal setelah migration: evaluasi apakah migration backward compatible. Restore DB hanya jika data rusak atau app tidak bisa jalan.
4. Jika DOKU webhook gagal: jangan rollback DB otomatis; nonaktifkan webhook sementara dan investigasi signature/log.
5. Dokumentasikan semua command dan waktu kejadian.

## Current Recommendation

Infrastructure siap untuk deploy manual terkontrol, tetapi public launch tetap menunggu DOKU production webhook UAT PASS.

