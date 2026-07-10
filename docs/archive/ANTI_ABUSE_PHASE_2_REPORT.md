# Anti-Abuse Phase 2 Report

Tanggal: 16 Juni 2026

## Executive Summary

Phase 2 anti-abuse sudah dipatch secara backend-only dan monitoring-first.

Perubahan ini:

- Tidak mengubah payment/membership/referral payout flow.
- Tidak memblokir user valid secara agresif.
- Menambahkan event log registrasi dan flag abuse untuk admin/security review.
- Menyiapkan device fingerprint optional dari mobile.
- Menambahkan rate limit register per normalized phone.

Tidak dilakukan:

- Deploy VPS.
- Build APK/AAB.
- Cleanup execute.
- Production migration execute.
- Production DB change.

## Existing Register Flow Audit

Sebelum patch:

- Register menerima `phone`, `password`, `referralCode`.
- Phone sudah dinormalisasi dari audit sebelumnya.
- Unique phone/email/referralCode ada di DB.
- Referral relation dibuat saat register jika referral code valid.
- Sponsor bonus tidak dibayar saat register.
- Basic PPOB benefit diberikan ke 1.000 USER pertama.

Gap:

- Tidak ada registration event table.
- Tidak ada device fingerprint monitoring.
- Tidak ada phone-specific register rate limit.
- Tidak ada abuse flag untuk high velocity device/IP/referral.

## Patch yang Dibuat

### Schema & Migration

Migration dibuat tapi **tidak dijalankan ke production**:

`apps/backend/prisma/migrations/0013_anti_abuse_registration_monitoring/migration.sql`

Perubahan schema:

- Enum `AbuseFlagStatus`
- Enum `AbuseFlagSeverity`
- Model `RegistrationEvent`
- Model `AbuseFlag`
- Relation ke `User`

Catatan: repo sudah memiliki migration `0013_legal_contact_requests`. Migration baru mengikuti nama yang diminta owner, tetapi sebelum deploy production disarankan review urutan migration karena ada dua prefix `0013`.

### Runtime

File diubah:

- `apps/backend/src/core/security/rateLimit.ts`
- `apps/backend/src/core/security/phone.ts`
- `apps/backend/src/modules/auth/presentation/auth.validators.ts`
- `apps/backend/src/modules/auth/presentation/auth.routes.ts`
- `apps/backend/src/modules/auth/presentation/auth.controller.ts`
- `apps/backend/src/modules/auth/domain/AuthRepository.ts`
- `apps/backend/src/modules/auth/application/AuthService.ts`
- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`

Perilaku:

- `deviceId` / `deviceFingerprint` optional diterima dari body.
- Header `x-tapgo-device-id` / `x-tapgo-device-fingerprint` optional diterima.
- Device identifier di-hash SHA-256 sebelum disimpan.
- Setiap register membuat `registration_events`.
- Kondisi suspicious membuat `abuse_flags`.
- Register by phone rate limit ditambahkan.

### Query Monitoring

File dibuat:

`scripts/anti-abuse-registration-monitoring.sql`

Query meliputi:

- Banyak akun dari device sama.
- Banyak akun dari IP sama.
- Referral chain mencurigakan.
- Basic PPOB farming risk.
- Open abuse flags.

## Expected Behavior

| Skenario | Expected |
| --- | --- |
| User register tanpa device ID | Register tetap sukses, event tercatat tanpa device hash. |
| User register dengan device ID baru | Event tercatat dengan hash. |
| Device sama register akun kedua | Register tetap sukses, `abuse_flags` HIGH dibuat. |
| IP sama >= 5 register/24 jam | Register tetap sukses, `abuse_flags` MEDIUM dibuat. |
| Referral code sama >= 10 register/24 jam | Register tetap sukses, `abuse_flags` LOW dibuat. |
| Phone sama format berbeda | Ditangani phone normalization + lookup variants. |

## Remaining Risk

| Risiko | Status |
| --- | --- |
| Mobile belum mengirim device ID | Backend siap, tetapi device rule baru efektif penuh setelah mobile mengirim identifier. |
| Tidak ada auto-block device | Sengaja monitoring-first agar tidak false positive. |
| Production migration belum dieksekusi | Sesuai instruksi. Harus apply staging/test dulu. |
| Privacy Policy/Data Safety | Perlu update sebelum mobile mengirim device fingerprint. |

## Recommendation

Closed Testing: **aman lanjut setelah backend patch diuji di test/staging DB**.

Public Launch: **lanjut setelah migration production disetujui, mobile mengirim device identifier, dan Privacy Policy/Data Safety diperbarui**.

## Validation Result

| Command | Result | Catatan |
| --- | --- | --- |
| `DATABASE_URL=postgresql://tapgo:tapgo@localhost:5433/tapgo_test npx prisma validate --schema apps/backend/prisma/schema.prisma` | PASS | Prisma schema valid. |
| `DATABASE_URL=postgresql://tapgo:tapgo@localhost:5433/tapgo_test npx prisma generate --schema apps/backend/prisma/schema.prisma` | PASS | Prisma Client lokal digenerate untuk validasi TypeScript. Tidak menjalankan migration. |
| `npm --workspace apps/backend run build` | PASS | TypeScript backend build sukses. |
| `npm --workspace apps/backend run test` | PASS dengan WARNING | 13 unit tests PASS; 88 integration tests skipped karena DB integration lokal tidak aktif. |

Catatan: sebelum deploy production, migration harus diuji di staging/test DB aktif agar event/flag table benar-benar tervalidasi runtime.
