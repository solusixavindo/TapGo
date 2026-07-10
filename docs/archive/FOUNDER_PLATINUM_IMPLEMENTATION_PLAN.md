# Founder Platinum Implementation Plan

Tanggal: 2026-06-17

## Status

Keputusan desain: **GO dengan migration nanti**

Tahap ini hanya perencanaan. Tidak ada deploy, build APK/AAB, migration execution, cleanup, atau production database change.

## Prinsip Implementasi

Founder Platinum harus:

- dibuat hanya oleh Super Admin
- tidak lewat register publik
- tidak lewat payment/order Midtrans
- tidak membuat invoice palsu
- tidak menambah revenue
- tidak memberi PPOB Platinum Rp1.000.000
- tetap berstatus Platinum untuk referral/commission eligibility
- memiliki audit trail lengkap
- dibatasi maksimal 10 akun

## Migration yang Direkomendasikan

### Pilihan Utama: Tabel Founder Platinum Grant

Tambahkan enum:

```prisma
enum FounderGrantStatus {
  ACTIVE
  REVOKED
}
```

Tambahkan model:

```prisma
model FounderPlatinumGrant {
  id                    String             @id @default(uuid()) @db.Uuid
  userId                String             @unique @map("user_id") @db.Uuid
  slotNumber            Int                @unique @map("slot_number")
  status                FounderGrantStatus @default(ACTIVE)
  profitSharingEligible Boolean            @default(false) @map("profit_sharing_eligible")
  grantedBy             String             @map("granted_by") @db.Uuid
  grantedAt             DateTime           @default(now()) @map("granted_at")
  revokedBy             String?            @map("revoked_by") @db.Uuid
  revokedAt             DateTime?          @map("revoked_at")
  reason                String?
  metadata              Json?

  user                  User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  grantActor            User               @relation("FounderGrantActor", fields: [grantedBy], references: [id])

  @@index([status, grantedAt])
  @@map("founder_platinum_grants")
}
```

Tambahkan relation pada `User`:

```prisma
founderPlatinumGrant FounderPlatinumGrant?
```

Catatan:

- Gunakan validasi application-level untuk slot 1-10.
- Jika database mendukung check constraint manual, tambahkan `slot_number BETWEEN 1 AND 10`.

### Alternatif: Source Field pada UserMembership

Lebih sederhana, tetapi kurang eksplisit:

```prisma
enum MembershipSource {
  REGISTRATION
  PAID_ORDER
  AUTO_UPGRADE
  ADMIN_GRANT
  FOUNDER_PLATINUM
}
```

Tambahkan ke `UserMembership`:

- `source`
- `grantedBy`
- `grantReason`
- `profitSharingEligible`
- `founderSlotNumber`

Kelemahan:

- Membebani tabel membership umum.
- Partial uniqueness untuk 10 slot lebih sulit dijaga lintas database/migration.

## Backend Service Design

Buat:

```text
apps/backend/src/modules/admin-console/application/FounderPlatinumService.ts
```

Method:

```ts
createFounderPlatinum(input: {
  fullName: string;
  phone: string;
  password: string;
  sponsorReferralCode?: string;
  slotNumber: number;
  reason?: string;
  adminId: string;
  ipAddress?: string;
  userAgent?: string;
})
```

Transaction steps:

1. Normalize phone.
2. Validate slot 1-10.
3. Validate admin role `SUPER_ADMIN`.
4. Check phone not used.
5. Check active founder count < 10.
6. Check slot not used.
7. Find Platinum membership.
8. Generate unique referral code with retry.
9. Hash password.
10. If sponsor code exists, find sponsor and block self/cycle.
11. Create user:
    - `role: USER`
    - `status: ACTIVE`
    - `membershipId: platinum.id`
12. Create wallet:
    - `balance: 0`
    - `cashBalance: 0`
    - `ppobBalance: 0`
13. Create `UserMembership`:
    - `membershipId: platinum.id`
    - `orderId: null`
    - `status: ACTIVE`
    - metadata includes `source: "FOUNDER_PLATINUM"`
14. Create `FounderPlatinumGrant`.
15. Create referral and referral levels if sponsor provided.
16. Create `AuditLog`:
    - action `FOUNDER_PLATINUM_GRANTED`
    - actorId adminId
    - entityType `user`
    - entityId new userId
    - metadata slot/reason/sponsor

## API Design

Endpoint:

```text
POST /api/v1/admin/founder-platinum
```

Role:

```text
SUPER_ADMIN only
```

Request:

```json
{
  "fullName": "Nama Founder",
  "phone": "+628xxxxxxxxxx",
  "password": "InitialPassword123",
  "sponsorReferralCode": "OPTIONAL",
  "slotNumber": 1,
  "reason": "Founder penghormatan"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "userId": "...",
    "fullName": "...",
    "phone": "...",
    "membershipTier": "PLATINUM",
    "membershipSource": "FOUNDER_PLATINUM",
    "slotNumber": 1,
    "wallet": {
      "cashBalance": 0,
      "ppobBalance": 0
    },
    "invoiceCreated": false,
    "paymentCreated": false
  }
}
```

## Report Adjustments

### Revenue Report

Founder Platinum tidak boleh muncul sebagai revenue karena:

- tidak ada `MembershipOrder`
- tidak ada `Invoice`
- tidak ada `Payment`

Tambahkan filter/section:

```text
Founder Platinum Grants: informational only, non-revenue
```

### PPOB Liability

Founder tidak boleh menghasilkan wallet transaction `PPOB_BENEFIT`.

Tambahkan test:

```text
Founder ppobBalance = 0
No PPOB_BENEFIT reference for founder grant
```

### Membership Summary

Rekomendasi tampilkan:

```text
Platinum Paid/Auto
Founder Platinum
Total Platinum Effective
```

### Profit Sharing

Default:

```text
profitSharingEligible = false
```

Ubah `ProfitSharingService.findActiveMembersByTier()` agar jika tier PLATINUM:

- exclude active founder grants dengan `profitSharingEligible = false`
- include only if owner explicitly enables

## Admin UI Flow

Menu:

```text
Super Admin > Membership > Founder Platinum
```

Fields:

- Nama lengkap
- Nomor HP
- Password awal
- Kode referral sponsor optional
- Slot Founder 1-10
- Catatan/reason

Confirm dialog:

```text
Akun ini akan dibuat sebagai Founder Platinum.
Tidak akan dibuat invoice/payment.
Tidak akan menerima PPOB Platinum Rp1.000.000.
Tidak akan dicatat sebagai revenue.
```

Output:

- User ID
- Referral code
- Slot number
- Membership Platinum
- Cash Rp0
- PPOB Rp0

## Test Plan

Unit tests:

1. slot outside 1-10 rejected
2. duplicate slot rejected
3. duplicate phone rejected
4. sponsor code invalid rejected
5. creates user with Platinum membership
6. wallet starts cash 0, ppob 0
7. no invoice/order/payment created
8. no PPOB_BENEFIT transaction created
9. audit log created

Integration tests:

1. Founder sponsor paid Silver gets 8%.
2. Founder upline receives level bonus up to Platinum level.
3. Founder appears in referral tree.
4. Founder not included in revenue report.
5. Founder not included in PPOB liability.
6. Founder excluded from profit sharing by default.
7. Max 10 active founder accounts.

## Rollout Plan

### Phase 0 - Owner Approval

Owner must decide:

- apakah Founder Platinum boleh ikut profit sharing
- siapa 10 akun yang berhak
- apakah slot bisa dicabut/revoked
- apakah user boleh mengubah password sendiri setelah dibuat

### Phase 1 - Migration Local/Test

- Buat migration baru.
- Jalankan hanya di test/local DB.
- Update Prisma generate.
- Tambah service/test.

### Phase 2 - UAT Internal

- Buat 1-2 Founder di test DB.
- Validasi referral/bonus.
- Validasi reports.
- Validasi no PPOB/no revenue.

### Phase 3 - Production Deploy Later

Hanya setelah:

- backup production
- migration sequence aman
- owner approval
- smoke test plan siap

## NO-GO Conditions

Jangan implementasi production jika:

- ingin memakai invoice/payment dummy
- ingin memakai manual SQL langsung di production
- belum ada source/flag Founder
- profit sharing belum diputuskan
- admin audit trail belum siap
- tidak ada test untuk no PPOB/no revenue

## Kesimpulan

Founder Platinum dapat dibangun aman jika memakai migration dan service khusus.

Keputusan final:

```text
GO dengan migration nanti
```

Tidak disarankan GO tanpa migration untuk production/public launch.
