# Pre-Launch Security and Data Checklist

Tanggal: 2026-06-13

## A. Production Data Audit

- [ ] Jalankan audit read-only di VPS:

```bash
npm --workspace apps/backend run audit:production-data
```

- [ ] Review `PRODUCTION_DATA_AUDIT_REPORT.md`.
- [ ] Pastikan akun UAT/test/dummy sudah teridentifikasi.
- [ ] Pastikan user real tidak masuk kandidat cleanup.
- [ ] Pastikan data wallet, invoice, commission, reward, withdrawal, dan profit sharing tidak dihapus.

## B. Backup Sebelum Cleanup

- [ ] Backup database:

```bash
pg_dump "$DATABASE_URL" > tapgo_prelaunch_backup_$(date +%Y%m%d_%H%M%S).sql
```

- [ ] Backup source:

```bash
tar -czf tapgo_source_backup_$(date +%Y%m%d_%H%M%S).tar.gz /var/www/Tapgo
```

- [ ] Simpan backup di lokasi aman.
- [ ] Catat hash/nama file backup.

## C. Cleanup Dry Run

- [ ] Jalankan:

```bash
npm --workspace apps/backend run cleanup:prelaunch -- --dry-run
```

- [ ] Review `PRE_LAUNCH_DATA_CLEANUP_PLAN.md`.
- [ ] Tentukan allowlist user ID yang benar-benar boleh dibersihkan.

## D. Cleanup Execute Jika Disetujui

- [ ] Pastikan backup sudah ada.
- [ ] Pastikan allowlist user ID sudah direview.
- [ ] Jalankan:

```bash
TAPGO_CLEANUP_CONFIRM=YES TAPGO_CLEANUP_USER_IDS="user-id-1,user-id-2" npm --workspace apps/backend run cleanup:prelaunch -- --execute
```

- [ ] Jalankan ulang audit read-only.
- [ ] Pastikan tidak ada data real yang hilang.

## E. Security Configuration

- [ ] `NODE_ENV=production`.
- [ ] `CORS_ORIGINS` hanya origin resmi:
  - `https://tapgolion.id`
  - `https://api.tapgolion.id`
- [ ] Tidak ada CORS wildcard `*`.
- [ ] Tidak ada localhost di production CORS.
- [ ] `JWT_ACCESS_SECRET` dan `JWT_REFRESH_SECRET` minimal 32 karakter.
- [ ] `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` sesuai environment merchant.
- [ ] `MIDTRANS_IS_PRODUCTION` sesuai status akun Midtrans.

## F. Security Endpoint Check

- [ ] User biasa mendapat 403 ketika akses `/api/v1/admin/dashboard/summary`.
- [ ] Admin dapat akses admin dashboard.
- [ ] Admin tidak dapat akses fitur Super Admin.
- [ ] Super Admin dapat akses semua endpoint admin.
- [ ] Midtrans notification menolak signature invalid.
- [ ] Rate limit aktif untuk auth/admin/payment.

## G. Validation Commands

```bash
npm --workspace apps/backend run build
npm --workspace apps/backend run test
npx prisma validate --schema apps/backend/prisma/schema.prisma
npx prisma generate --schema apps/backend/prisma/schema.prisma
```

## H. Go / No-Go

Go hanya jika:

- [ ] Audit production data selesai.
- [ ] Cleanup dry-run direview.
- [ ] Cleanup execute, jika perlu, sudah dilakukan dengan backup.
- [ ] Security validation pass.
- [ ] Backend build/test/prisma pass.
- [ ] Smoke test production pass.

No-Go jika:

- [ ] DB audit tidak bisa dijalankan.
- [ ] Ada user real masuk kandidat cleanup tanpa alasan jelas.
- [ ] Ada CORS wildcard/localhost di production.
- [ ] Role guard admin gagal.
- [ ] Midtrans signature dapat dibypass.
- [ ] Build/test/prisma gagal.
