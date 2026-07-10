# Founder Chairman Implementation Plan

Tanggal: 2026-06-17

## Status

Tahap ini hanya rencana implementasi. Tidak ada deploy, build APK/AAB, migration execution, cleanup, atau production database change.

Keputusan: **GO dengan migration nanti**

## Desain Schema yang Direkomendasikan

Tambahkan enum:

```prisma
enum FounderRole {
  FOUNDER_CHAIRMAN
  FOUNDER_PLATINUM
}

enum FounderGrantStatus {
  ACTIVE
  REVOKED
}
```

Tambahkan model:

```prisma
model FounderProgramGrant {
  id                    String             @id @default(uuid()) @db.Uuid
  userId                String             @unique @map("user_id") @db.Uuid
  founderRole           FounderRole        @map("founder_role")
  slotNumber            Int?               @map("slot_number")
  status                FounderGrantStatus @default(ACTIVE)
  profitSharingEligible Boolean            @default(false) @map("profit_sharing_eligible")
  grantedBy             String             @map("granted_by") @db.Uuid
  grantedAt             DateTime           @default(now()) @map("granted_at")
  revokedBy             String?            @map("revoked_by") @db.Uuid
  revokedAt             DateTime?          @map("revoked_at")
  reason                String?
  metadata              Json?

  user                  User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([founderRole, status])
  @@index([status, grantedAt])
  @@map("founder_program_grants")
}
```

Tambahkan relation pada `User`:

```prisma
founderProgramGrant FounderProgramGrant?
```

Database constraints yang disarankan jika memungkinkan:

- active `FOUNDER_CHAIRMAN` maksimal 1
- active `FOUNDER_PLATINUM` maksimal 10
- `slotNumber` required dan unique untuk Founder Platinum
- `slotNumber` null untuk Founder Chairman

Jika partial index sulit, enforce di service dengan transaction serializable.

## Backend Changes

### Service

Buat:

```text
apps/backend/src/modules/admin-console/application/FounderProgramService.ts
```

Methods:

```ts
createFounderChairman(input)
createFounderPlatinum(input)
revokeFounderGrant(input)
updateFounderProfitSharingEligibility(input)
listFounderGrants(input)
```

### Create Founder Chairman Flow

Input:

- fullName
- phone
- initialPassword
- sponsorReferralCode optional
- reason
- adminId
- ipAddress optional
- userAgent optional

Transaction:

1. Require `SUPER_ADMIN`.
2. Validate no active Founder Chairman exists.
3. Normalize phone and check unique.
4. Find Platinum membership.
5. Generate referral code unique.
6. Hash initial password.
7. Create user with `membershipId = PLATINUM`.
8. Create wallet:
   - `balance = 0`
   - `cashBalance = 0`
   - `ppobBalance = 0`
9. Create active `UserMembership`:
   - membership Platinum
   - orderId null
   - metadata source `FOUNDER_CHAIRMAN`
10. Create `FounderProgramGrant`.
11. Create referral relation/referral levels if sponsor code provided.
12. Create `AuditLog` action `FOUNDER_CHAIRMAN_GRANTED`.
13. Return user, referral code, role, wallet balances, and flags:
    - invoiceCreated false
    - paymentCreated false
    - ppobGranted false

### Create Founder Platinum Flow

Same as Chairman, but:

- founderRole `FOUNDER_PLATINUM`
- validate active Founder Platinum count < 10
- validate slotNumber 1-10
- validate slot unused
- audit action `FOUNDER_PLATINUM_GRANTED`

## API Design

Routes:

```text
POST /api/v1/admin/founder-program/chairman
POST /api/v1/admin/founder-program/platinum
GET  /api/v1/admin/founder-program
POST /api/v1/admin/founder-program/:id/revoke
PUT  /api/v1/admin/founder-program/:id/profit-sharing-eligibility
```

Role:

```text
SUPER_ADMIN only
```

## Admin Panel Changes

Menu:

```text
Super Admin > Founder Program
```

Tabs:

- Founder Chairman
- Founder Platinum
- Audit/History

Founder Chairman form:

- nama
- phone
- password awal
- referral sponsor optional
- reason

Founder Platinum form:

- nama
- phone
- password awal
- referral sponsor optional
- slot 1-10
- reason

Confirmation text:

```text
Akun Founder akan dibuat sebagai Platinum efektif.
Tidak dibuat invoice/payment.
Tidak diberikan PPOB Platinum.
Tidak dicatat sebagai revenue.
```

## Reporting Changes

Membership Summary:

```text
Basic
Silver
Gold
Platinum Paid
Platinum Auto Upgrade
Founder Chairman
Founder Platinum
Total Platinum Effective
```

Revenue Report:

- exclude Founder Program
- show informational count only

PPOB Report:

- Founder Program should have `ppobBalance = 0`
- no `PPOB_BENEFIT` transaction

Commission Report:

- include Founder Program if they receive sponsor/level bonus from paid downline
- metadata should show beneficiary founderRole where useful

Profit Sharing Report:

- exclude founder grants where `profitSharingEligible = false`
- if true, show category explicitly for audit

## Audit Trail Changes

Add audit log calls:

- `FOUNDER_CHAIRMAN_GRANTED`
- `FOUNDER_CHAIRMAN_REVOKED`
- `FOUNDER_PLATINUM_GRANTED`
- `FOUNDER_PLATINUM_REVOKED`
- `FOUNDER_PROFIT_SHARING_ELIGIBILITY_UPDATED`

Metadata:

- actorId
- targetUserId
- founderRole
- slotNumber
- reason
- previousStatus
- newStatus
- profitSharingEligible
- ipAddress
- userAgent

## Test Plan

Unit tests:

1. create chairman succeeds when none exists
2. second chairman rejected
3. admin role rejected
4. user role rejected
5. chairman wallet starts cash 0 ppob 0
6. no invoice/order/payment for chairman
7. no PPOB_BENEFIT for chairman
8. platinum slots 1-10 only
9. 11th platinum rejected
10. audit logs created

Integration tests:

1. Founder Chairman sponsors paid Silver and receives sponsor bonus.
2. Founder Chairman receives level bonus as Platinum effective.
3. Founder Chairman appears in referral tree.
4. Founder Chairman excluded from revenue.
5. Founder Chairman excluded from PPOB liability.
6. Founder Chairman excluded from profit sharing by default.
7. Profit sharing includes Chairman only after explicit eligibility update.

## Urutan Implementasi

1. Owner approval final:
   - profit sharing default false/true
   - revoke policy
   - siapa akun Chairman
   - daftar 10 Founder Platinum
2. Buat migration lokal/test untuk `FounderProgramGrant`.
3. Update Prisma generate lokal.
4. Implement `FounderProgramService`.
5. Implement admin routes validators.
6. Tambah audit log.
7. Update reports.
8. Tambah unit/integration tests.
9. UAT lokal/test DB.
10. Production deploy hanya setelah Google/Midtrans selesai review dan backup siap.

## Rollback Plan

Jika fitur belum dipakai production:

- rollback code sebelum deploy
- drop migration hanya di test/local DB jika masih development

Jika sudah production nanti:

- revoke founder grant, jangan hard delete
- set user status sesuai keputusan owner
- jangan hapus ledger/referral history

## Kesimpulan

Founder Chairman bisa diintegrasikan aman jika memakai Founder Program generik.

Tidak disarankan implementasi tanpa migration karena limit 1 akun, reporting, audit trail, dan profit sharing eligibility membutuhkan field eksplisit.
