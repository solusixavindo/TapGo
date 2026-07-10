# Release Candidate Audit TapGo RC-1

Tanggal audit: 4 Juni 2026  
Scope: Membership, Referral, Wallet, Withdrawal, Admin Console, Android Play Store readiness  
Status: RC-1 audit only, tidak ada fitur baru diimplementasikan.

## Executive Summary

TapGo siap untuk UAT/presentasi klien dengan confidence tinggi, tetapi belum siap untuk Google Play production submission. Risiko terbesar untuk production adalah payment simulator endpoint yang masih aktif, package/signing Android masih default debug/example, belum ada privacy policy/terms, dan integration test database belum aktif di pipeline lokal.

Kesiapan UAT klien: 88%  
Kesiapan Play Store: 52%

## Validation Result

| Check | Result | Notes |
| --- | --- | --- |
| Backend build | PASS | `npm --workspace apps/backend run build` |
| Backend test | PASS | 5 passed, 60 skipped |
| Flutter analyze | PASS | No issues found |
| Flutter test | PASS | 6 passed |
| Flutter build APK debug | PASS | APK debug berhasil dibuat |

Catatan: integration tests backend skipped karena `TAPGO_TEST_DATABASE_URL` belum disiapkan.

## Critical Issues

### CR-1: Payment simulator endpoint masih dapat mengaktifkan membership

Endpoint `POST /api/v1/membership/orders/:id/payment-success` masih tersedia untuk authenticated user. Endpoint ini memanggil flow `markPaymentSuccess`, sehingga pada environment production berisiko mengaktifkan invoice/membership tanpa callback payment gateway yang valid.

Impact:
- Membership bisa aktif tanpa Midtrans callback.
- PPOB benefit, sponsor bonus, level bonus, dan reward dapat ikut terpicu.
- Risiko finansial tinggi jika endpoint tidak dimatikan/di-guard sebelum production.

Recommendation:
- Blok endpoint simulator saat `NODE_ENV=production`.
- Batasi hanya `SUPER_ADMIN` atau dev-only flag.
- Pastikan Flutter hanya memakai simulator jika `development mode`.

### CR-2: Android release signing masih memakai debug signing

`apps/user_app/android/app/build.gradle.kts` masih memakai signing config debug untuk release.

Impact:
- APK/AAB belum bisa dianggap production release.
- Tidak layak untuk upload Play Store final.

Recommendation:
- Buat upload keystore khusus TapGo.
- Konfigurasi `key.properties`.
- Pakai signing config release.
- Simpan secret di environment/CI, bukan commit repo.

### CR-3: Package name masih default example

`applicationId` masih `com.example.tapgo_user_app`.

Impact:
- Tidak layak untuk brand Play Store.
- Berisiko bentrok/terlihat tidak profesional.
- Sulit migrasi setelah rilis jika sudah publish.

Recommendation:
- Ganti ke package resmi, contoh `id.tapgolion.app` atau domain legal final PT. TAPGO LION INDONESIA.
- Update namespace Android secara konsisten.

### CR-4: Privacy policy dan terms belum tersedia

Audit repo tidak menemukan dokumen privacy policy/terms.

Impact:
- Wajib untuk Play Store karena app memakai kamera, storage/photo picker, auth, data user, payment, wallet, dan referral.
- Risiko ditolak saat submission.

Recommendation:
- Siapkan Privacy Policy publik.
- Siapkan Terms & Conditions.
- Tambahkan link di app dan Play Console.

## Major Issues

### MJ-1: Integration test backend masih skipped

Backend tests lulus, tetapi sebagian besar integration tests skipped karena test database belum aktif.

Impact:
- Flow DB real seperti payment, wallet ledger, withdrawal, profit sharing, admin console belum otomatis tervalidasi pada RC run.

Recommendation:
- Siapkan `TAPGO_TEST_DATABASE_URL`.
- Jalankan full integration test sebelum production freeze.

### MJ-2: Midtrans signature check optional jika server key/signature kosong

Callback Midtrans memverifikasi signature hanya jika `signature_key` dan `MIDTRANS_SERVER_KEY` tersedia.

Impact:
- Aman jika env production lengkap.
- Berisiko jika production env salah konfigurasi, karena callback tanpa signature dapat diproses.

Recommendation:
- Pada `NODE_ENV=production`, wajibkan `MIDTRANS_SERVER_KEY` dan `signature_key`.
- Fail closed jika signature tidak ada.

### MJ-3: Demo/fallback path masih ada di aplikasi

Flutter masih mempertahankan fallback demo mode ketika API gagal.

Impact:
- Bagus untuk presentasi.
- Tidak cocok untuk production karena user dapat melihat data demo atau misleading state.

Recommendation:
- Untuk production flavor, matikan fallback demo.
- Gunakan error/retry state real.
- Pisahkan build flavor `demo` dan `production`.

### MJ-4: App label masih teknis

Android label masih `tapgo_user_app`.

Impact:
- Tidak siap Play Store/branding.

Recommendation:
- Ganti label menjadi `TapGo`.

### MJ-5: App icon launcher perlu final verification

Launcher icon ada, tetapi audit tidak memverifikasi apakah semua density memakai logo resmi TapGo terbaru.

Impact:
- Risiko icon Play Store/emulator tidak sesuai brand resmi.

Recommendation:
- Regenerate launcher icon dari logo resmi TapGo.
- Verifikasi adaptive icon Android.

### MJ-6: Permission review belum final

Manifest meminta `CAMERA`, `READ_MEDIA_IMAGES`, dan `READ_EXTERNAL_STORAGE maxSdkVersion=32`.

Impact:
- Permission sesuai kebutuhan scan QR/upload KTP/selfie.
- Tetap perlu privacy disclosure jelas.

Recommendation:
- Pastikan permission rationale di UX.
- Pastikan Play Console Data Safety menyebut kamera/foto dan dokumen KTP/selfie.

### MJ-7: Logout belum memanggil backend logout endpoint

Flutter logout membersihkan local secure storage/session, tetapi audit tidak menemukan panggilan `/auth/logout` dari UI logout.

Impact:
- Refresh session server-side bisa tetap aktif sampai expiry.

Recommendation:
- Sebelum production, panggil backend logout lalu clear local session.
- Tetap clear local session jika API logout gagal.

### MJ-8: Admin action screens sebagian masih placeholder

Menu sensitif seperti Commission Settings, Membership Package Settings, Role Management, Audit Log, dan App Settings sengaja berupa approval/placeholder.

Impact:
- Aman untuk presentasi.
- Belum production lengkap untuk operasional admin.

Recommendation:
- Jangan demo sebagai fitur production-ready.
- Label sebagai controlled/approval feature.

## Minor Issues

### MN-1: Flutter plugin warnings

Build menampilkan warning:
- beberapa plugin belum support Swift Package Manager untuk iOS/macOS.
- beberapa plugin masih apply Kotlin Gradle Plugin sendiri.

Impact:
- Tidak memblokir Android debug build saat ini.
- Bisa menjadi masalah pada Flutter versi mendatang.

Recommendation:
- Upgrade plugin saat masuk fase release hardening.

### MN-2: Debug APK masih besar

APK presentasi sekitar 193 MB.

Impact:
- Normal untuk debug, tetapi tidak layak distribusi production.

Recommendation:
- Build release AAB untuk Play Store setelah signing siap.

### MN-3: Backend Redis dependency noisy ketika Redis mati

Saat Redis tidak hidup, backend log dapat dipenuhi `ioredis ECONNREFUSED`.

Impact:
- Tidak ideal untuk demo jika Docker Redis belum jalan.

Recommendation:
- Pastikan `docker compose up -d` sebelum demo.
- Tambahkan graceful Redis unavailable handling sebelum production.

## Flow Audit

### Register/Login/Logout

Status:
- Register/login backend tersedia.
- Role dari backend disimpan ke session.
- Role gate Flutter mengarah ke dashboard sesuai role.
- Logout local berjalan.

Risk:
- Logout belum revoke backend session.
- Demo fallback masih aktif jika API gagal.

Priority:
- P1 untuk production logout revoke.
- P2 untuk pisah demo/production fallback.

### Membership

Status:
- Package list, order, invoice, activation, active membership tersedia.
- Duplicate pending order dicegah per user untuk status PENDING.
- Active membership lama ditutup saat upgrade.

Risk:
- Dev payment success endpoint masih aktif.

Priority:
- P0 untuk mematikan simulator pada production.

### Payment

Status:
- Midtrans Snap create endpoint tersedia.
- Midtrans callback idempotent terhadap invoice yang sudah final.
- Pending/failed/expired/cancel handling tersedia.

Risk:
- Signature verification optional jika env/signature kosong.
- Payment simulator endpoint production risk.

Priority:
- P0 untuk fail-closed production signature dan simulator guard.

### Referral

Status:
- Referral relation, referral level, recursive tree, self/circular prevention tersedia di service/repository.
- Referral path memakai unique constraint.

Risk:
- Harus divalidasi full integration test dengan DB test aktif.

Priority:
- P1 setup integration test DB.

### Wallet

Status:
- Wallet ledger tercatat.
- Withdrawal reserve memakai atomic balance decrement dengan syarat balance cukup.
- Negative balance risk pada withdrawal request cukup terkontrol.

Risk:
- Tidak terlihat database-level check constraint `balance >= 0`.

Priority:
- P1 tambahkan DB check constraint sebelum production.

### Commission/Reward/Profit Sharing

Status:
- Duplicate commission dicegah via unique constraint `beneficiaryId + triggerType + triggerId + type + level`.
- Payment success transaction memakai Serializable transaction.
- Profit sharing distribution unique per `periodId + userId`.

Risk:
- Wallet transaction sendiri belum punya unique reference untuk semua payout, mengandalkan commission uniqueness.
- Full integration tests skipped.

Priority:
- P1 full integration test.
- P2 unique ledger reference tambahan bila diperlukan.

### Withdrawal

Status:
- Create withdrawal: minimum Rp50.000, saldo cukup, wallet decremented.
- Approve hanya dari PENDING.
- Reject hanya dari PENDING, refund sekali.
- Paid hanya dari APPROVED dan hanya SUPER_ADMIN pada admin route.

Risk:
- Mark paid membuat zero-amount `ADJUSTMENT`, bukan dedicated type `WITHDRAWAL_PAID`.

Priority:
- P3 naming ledger improvement, tidak blocking UAT.

### Admin

Status:
- Admin endpoints guarded by ADMIN/SUPER_ADMIN.
- Sensitive routes guarded SUPER_ADMIN.
- User biasa ditolak.

Risk:
- Smoke test live admin membutuhkan Docker/Postgres/Redis aktif.
- Beberapa admin menu masih placeholder.

Priority:
- P1 run live UAT with Docker infra.

## Database Audit

Strengths:
- UUID primary keys.
- Unique user phone/email/referralCode.
- Unique referral per user.
- Unique referral closure pair.
- Unique commission duplicate-prevention key.
- Unique profit sharing distribution per period/user.
- Indexes tersedia untuk role/status, membership, referral levels, wallet ledger, invoice status.

Risks:
- Tidak ada DB check constraint eksplisit untuk wallet balance non-negative.
- Wallet transaction idempotency tidak seragam di DB; beberapa flow mengandalkan commission uniqueness atau app logic.
- Demo seeder menghapus data berdasarkan phone/kode demo; aman untuk demo, tetapi tidak boleh dipakai di production.

Recommendation:
- Tambahkan check constraint `wallets.balance >= 0` sebelum production.
- Tambahkan unique ledger reference untuk payout critical jika diperlukan.
- Jalankan orphan data query sebelum production migration freeze.

## Play Store Readiness Audit

Blocking before submission:
- Package name masih `com.example.tapgo_user_app`.
- Release signing masih debug.
- Privacy policy belum ada.
- Terms & Conditions belum ada.
- App label masih `tapgo_user_app`.
- Production build flavor belum dipisah dari demo fallback.
- Midtrans masih sandbox/dev simulator.

Ready:
- Android debug build berhasil.
- Permission dasar sesuai fitur demo.
- Logo asset aplikasi tersedia.

Recommendation before Google Play submission:
1. Tentukan package id final.
2. Buat release signing dan build AAB.
3. Tambahkan privacy policy/terms.
4. Matikan demo fallback dan payment simulator pada production.
5. Wajibkan Midtrans signature pada production.
6. Siapkan Play Console Data Safety.
7. Siapkan app icon/adaptive icon final.
8. Jalankan full integration tests.

## Security Audit

Strengths:
- JWT access/refresh tersedia.
- Password di-hash.
- Admin routes pakai role middleware.
- Auth rate limiter tersedia.
- Input validation memakai Zod.
- Prisma ORM mengurangi risiko SQL injection.

Risks:
- Dev payment success endpoint.
- Midtrans signature optional jika env kosong.
- Demo fallback dapat membingungkan production user.
- Logout tidak revoke backend session dari Flutter.
- Production secrets/config readiness belum diverifikasi.

## Priority Fix List

P0 before production:
- Disable/guard payment simulator endpoint.
- Configure release signing.
- Change package name.
- Add privacy policy and terms.
- Enforce Midtrans signature in production.

P1 before release candidate production:
- Setup `TAPGO_TEST_DATABASE_URL` and run full integration tests.
- Add wallet non-negative DB check constraint.
- Call backend logout from Flutter logout.
- Verify app icon/adaptive icon final.
- Run live UAT with Docker infra active.

P2 after UAT:
- Separate demo and production Flutter flavors.
- Add privacy/terms screen links in app.
- Improve Redis unavailable handling.
- Add unique ledger idempotency constraints where needed.

P3 cleanup:
- Rename zero-amount paid withdrawal ledger type from `ADJUSTMENT` to a clearer type in a later schema cycle.
- Upgrade plugin dependencies to remove future Flutter warnings.

## Readiness Score

UAT klien: 88%

Reasoning:
- Core demo flow and admin role flow are implemented.
- Automated Flutter validation passes.
- Backend unit validation passes.
- Demo seed/reset and APK are ready.
- Remaining UAT blockers are mostly environment setup and live DB smoke test.

Play Store production: 52%

Reasoning:
- App builds, backend builds, and core architecture exists.
- However package/signing/privacy/terms/payment simulator/production flavor are not Play Store ready.

## Final Recommendation

Proceed with client UAT/presentation after:
- Docker Desktop, PostgreSQL, and Redis are confirmed running.
- `reset:demo` is executed once before presentation.
- SUPER_ADMIN/ADMIN/member accounts are smoke-tested on the emulator.

Do not submit to Google Play until all P0 items are closed.
