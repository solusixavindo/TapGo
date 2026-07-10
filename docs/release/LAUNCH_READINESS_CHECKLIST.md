# TapGo Launch Readiness Checklist

Tanggal: 17 Juni 2026

Scope: checklist operasional public launch TapGo. Dokumen ini tidak menjalankan deploy, migration, cleanup, build APK/AAB, atau perubahan production DB.

## A. Infrastruktur

| Item | Status | Verifikasi |
| --- | --- | --- |
| VPS health | TODO | `ssh VPS && uptime` |
| PM2 status | TODO | `pm2 status tapgo-api` |
| PM2 logs bersih | TODO | `pm2 logs tapgo-api --lines 100` |
| Nginx aktif | TODO | `sudo nginx -t && systemctl status nginx` |
| SSL valid | TODO | buka `https://api.tapgolion.id/health` dari browser dan `curl -I` |
| Domain API | TODO | `https://api.tapgolion.id` mengarah ke VPS production |
| Database PostgreSQL aktif | TODO | `systemctl status postgresql` atau managed DB health |
| Redis aktif | TODO | `systemctl status redis` jika dipakai |
| Backup database | BLOCKER sebelum public launch | `pg_dump` production dengan timestamp |
| Backup `.env` backend | BLOCKER sebelum public launch | salin `.env` ke folder backup aman |
| Backup source `/var/www/Tapgo` | BLOCKER sebelum deploy besar | tar/zip source current |
| Disk space | TODO | `df -h` minimal 20% free |
| Monitoring uptime | TODO | Uptime monitor untuk `/health` |

## B. Backend

| Item | Status | Verifikasi |
| --- | --- | --- |
| Migration status | WARNING | Anti-abuse migration belum dijalankan; ada conflict prefix `0013` |
| Prisma generate | TODO | `npm --workspace apps/backend run db:generate` atau `npx prisma generate` |
| Build PASS | TODO | `npm --workspace apps/backend run build` |
| Test PASS | TODO | `npm --workspace apps/backend run test` dengan DB integration jika tersedia |
| Smoke test | TODO | `API_BASE_URL=https://api.tapgolion.id ./scripts/smoke-test-p1-financial.sh` |
| Health endpoint | TODO | `curl https://api.tapgolion.id/health` |
| Admin endpoint guard | TODO | USER token harus 403 di `/api/v1/admin/dashboard/summary` |
| User endpoint guard | TODO | tanpa token harus 401 di `/api/v1/wallet` |
| Midtrans callback route | TODO | `/api/v1/payments/midtrans/notification` tersedia |
| Rate limit login/register | READY IN CODE | `authRateLimiter` + phone register limiter |
| Phone normalization | READY IN CODE | `0812`, `62812`, `+62812` canonical |
| Anti-abuse monitoring | READY IN CODE, NOT DEPLOYED | butuh migration + deploy backend |

## C. Mobile App

| Item | Status | Verifikasi |
| --- | --- | --- |
| Google Play release status | IN REVIEW | Closed Testing Alpha |
| Package name | TODO | Cocok dengan Play Console |
| Version code | TODO | Lebih tinggi dari release sebelumnya |
| Version name | TODO | Sesuai release notes |
| AAB signing | TODO | Release signing tidak fallback debug |
| App icon | READY | Logo resmi TapGo |
| Feature graphic | READY | Google Play asset final |
| Screenshots | PARTIAL/READY | User-facing screenshots sudah dibuat, cek admin screenshots jika perlu |
| Data Safety | TODO | Update bila device identifier dikirim mobile |
| App Access reviewer credential | TODO | Sediakan akun review bila Play Console meminta |
| Privacy Policy URL | READY | `https://tapgolion.id/privacy-policy` |
| Terms URL | READY | `https://tapgolion.id/terms-and-conditions` |
| Delete Account URL | READY | `https://tapgolion.id/legal/delete-account` atau route setara |
| Photo/video permission | REVIEW | Pastikan permission hanya jika fitur upload aktif |

## D. Payment

| Item | Status | Verifikasi |
| --- | --- | --- |
| Midtrans production key | TODO | Cek `.env` VPS, jangan expose key |
| Midtrans channel active | BLOCKER | Masih menunggu review/aktivasi Midtrans |
| Snap payment page | PARTIAL PASS | Snap terbuka, channel belum tersedia |
| Notification signature verification | READY | Production wajib signature valid |
| Membership active after paid | READY | `markPaymentSuccess` dari callback valid |
| Pending order handling | READY | Pending tidak memicu bonus |
| Expired/cancelled handling | READY | Terminal status tidak memicu bonus |
| Payment simulator production disabled | READY | Simulator ditolak di production |

## E. Business Engine

| Item | Status | Verifikasi |
| --- | --- | --- |
| Basic package | READY | Basic otomatis saat register |
| Silver package | READY | Rp500.000, PPOB Rp100.000 |
| Gold package | READY | Rp3.000.000, PPOB Rp600.000 |
| Platinum package | READY | Rp5.500.000, PPOB Rp1.000.000 |
| Referral sponsor bonus | READY | Basic Rp2.000, non-Basic 8%, paid-only |
| Level bonus | READY | Tier/rate sesuai engine final |
| Wallet ledger | READY | Cash/PPOB terpisah |
| PPOB balance separation | READY | PPOB tidak withdrawable |
| Commission after valid payment only | READY | Register tidak membayar sponsor |
| Reward lifecycle | READY BACKEND | Pending/approve/reject/paid |
| Profit sharing | READY BACKEND, NEED SOP | Super Admin controlled |

## F. Security

| Item | Status | Verifikasi |
| --- | --- | --- |
| JWT secrets | TODO | Min 32 chars, production secret bukan default |
| Refresh token hashing | READY | Hash + reuse detection |
| Rate limits | READY BASIC | API/auth/admin/payment limiter |
| Phone normalization | READY | Patch active after deploy |
| Anti-abuse monitoring | READY IN CODE | Migration/deploy pending |
| Admin role guard | READY | ADMIN/SUPER_ADMIN |
| Super Admin role guard | READY | super-only action guarded |
| File upload validation | WARNING | Upload route belum aktif; hardening wajib jika KTP/selfie aktif |
| Error masking | READY | 500 generic |
| CORS production safe | READY IN CODE | unsafe production CORS throws |

## G. Operations

| SOP | Status | Owner |
| --- | --- | --- |
| SOP membership approval | TODO | Admin/Super Admin |
| SOP withdrawal approve/reject/paid | TODO | Admin/Super Admin |
| SOP refund/reversal | TODO | Finance/Admin |
| SOP complaint handling | TODO | Support |
| SOP reward payout | TODO | Super Admin/Finance |
| SOP profit sharing | TODO | Super Admin/Finance |
| Support email active | TODO | `support@tapgolion.id` |
| Support WhatsApp active | TODO | `+62 838-0025-5588` |
| Incident contact list | TODO | Owner/DevOps/Support |

## H. Go / No-Go Decision

### Closed Testing Ready

Status: **GO**

Syarat:

- Gunakan data UAT terkendali.
- Jangan cleanup execute.
- Jangan payout reward/profit sharing real massal.
- Monitor Midtrans channel status.

### Public Launch Ready

Status: **NO-GO sampai blocker selesai**

Blocker:

1. Midtrans payment channel aktif dan retest PASS.
2. Migration anti-abuse sequence direview/direname.
3. Backup production dibuat.
4. Cleanup dummy data final disetujui dan dieksekusi dengan allowlist.
5. Device fingerprint/Data Safety/legal update selesai jika mobile mengirim device ID.
6. SOP financial operations disetujui.

### Bisa Dimonitor Post-Launch

- Threshold anti-abuse IP/referral velocity.
- Admin UI untuk abuse flags.
- Advanced KYC/withdrawal hold tuning.

