# Founder Platinum Design Review TapGo

Tanggal: 2026-06-17

## Tujuan

Mendesain fitur **Founder Platinum** untuk maksimal 10 akun penghormatan yang dibuat oleh Admin/Super Admin, dengan karakteristik:

- user belum punya akun
- dibuat/input oleh admin
- status membership dianggap Platinum
- tidak menerima PPOB balance Rp1.000.000
- tidak dicatat sebagai revenue
- tidak dibuat invoice/payment palsu
- berhak menerima sponsor bonus
- berhak menerima level bonus
- berhak membangun jaringan referral seperti Platinum biasa

Audit ini tidak melakukan deploy, build APK/AAB, migration, cleanup, atau perubahan production database.

## Ringkasan Keputusan

Keputusan: **GO dengan migration nanti**

Founder Platinum **tidak direkomendasikan dibuat tanpa migration** untuk public launch karena schema saat ini belum memiliki field eksplisit untuk membedakan Platinum berbayar, auto-upgrade Platinum, dan Founder Platinum.

Secara teknis, user bisa dibuat sebagai `PLATINUM` memakai `users.membershipId` dan `user_memberships`, tetapi tanpa field source akan muncul risiko:

- Founder Platinum ikut dihitung sebagai Platinum biasa di profit sharing.
- Sulit dibedakan dari Platinum berbayar di admin/report.
- Sulit dibatasi maksimal 10 akun.
- Audit trail dan compliance lemah.
- Potensi salah tafsir revenue/report karena tidak ada marker resmi.

## Audit Schema Saat Ini

### Membership Tier

Schema saat ini:

```text
MembershipTier:
- BASIC
- SILVER
- GOLD
- PLATINUM
```

Tidak ada tier khusus `FOUNDER_PLATINUM`.

### User

`User` memiliki:

- `membershipId`
- `referralCode`
- wallet relation
- referral relations
- commissions
- userMemberships

Tidak ada:

- `membershipSource`
- `founderPlatinum`
- `founderSlotNumber`
- `grantedBy`
- `grantedReason`

### UserMembership

`UserMembership` memiliki:

- `userId`
- `membershipId`
- `orderId?`
- `status`
- `metadata`

Field `metadata` bisa menyimpan source sementara, tetapi tidak cukup kuat untuk:

- unique constraint maksimal 10 founder
- query/report yang konsisten
- filter profit sharing secara aman
- audit/admin review formal

### MembershipOrder / Invoice / Payment

`MembershipOrder`, `Invoice`, dan `MembershipPayment` terkait flow berbayar. Founder Platinum **tidak boleh** membuat order/invoice/payment palsu.

Kesimpulan:

- Founder Platinum tidak boleh menggunakan `MembershipOrderService.markPaymentSuccess()`.
- Founder Platinum tidak boleh membuat `MembershipOrder`, `Invoice`, atau `MembershipPayment`.

### Wallet

Wallet memiliki:

- `balance`
- `cashBalance`
- `ppobBalance`

Untuk Founder Platinum:

- `cashBalance = 0` saat dibuat
- `ppobBalance = 0` saat dibuat
- tidak ada wallet transaction `PPOB_BENEFIT`
- boleh menerima cash dari sponsor/level bonus ke depan

## Audit Business Engine

### Registration Basic

`PrismaAuthRepository.createUser()` membuat user Basic, wallet, PPOB Basic untuk 1000 user pertama, dan referral relation bila ada sponsor.

Founder Platinum tidak boleh memakai flow register publik biasa karena:

- user akan menjadi Basic dulu
- bisa mendapat Basic PPOB Rp5.000 jika termasuk 1000 user pertama
- tidak mencatat source Founder Platinum

### Membership Payment Flow

`MembershipOrderService.markPaymentSuccess()`:

1. mengubah invoice/order menjadi PAID
2. membuat `UserMembership`
3. update `users.membershipId`
4. memberi PPOB benefit berdasarkan package
5. memberi sponsor bonus
6. memberi level bonus
7. evaluasi reward
8. evaluasi auto-upgrade

Founder Platinum tidak boleh memakai flow ini karena akan:

- mencatat payment/order/invoice
- memberi PPOB Platinum Rp1.000.000
- mencemari revenue/payment report

### Sponsor Bonus dan Level Bonus

Sponsor/level bonus eligibility mengambil tier lewat `getUserCurrentTier()`, yang melihat `UserMembership ACTIVE` atau `users.membershipId`.

Jika Founder Platinum punya active membership `PLATINUM`, maka:

- bisa menerima sponsor bonus 8%
- bisa menerima level bonus sampai level 10
- bisa menjadi sponsor/upline di referral tree

Ini sesuai requirement.

### Profit Sharing

`ProfitSharingService.findActiveMembersByTier()` saat ini mencari:

```text
userMembership.status = ACTIVE
membership.tier = PLATINUM
```

Tanpa source filter, Founder Platinum akan dihitung sebagai penerima profit sharing Platinum. Requirement tidak menyebut hak profit sharing Founder Platinum.

Risiko:

- Jika Founder Platinum tidak seharusnya menerima profit sharing, harus ada field exclusion.
- Jika Founder Platinum boleh menerima profit sharing, perlu approval owner dan disclosure.

Rekomendasi: **default Founder Platinum tidak otomatis masuk profit sharing sampai owner menyetujui**.

### Revenue Report

Revenue report berbasis membership order/invoice/payment paid. Founder Platinum aman dari revenue report jika tidak membuat order/invoice/payment.

Namun tanpa field source, admin report membership count akan melihatnya sebagai Platinum biasa. Ini perlu disclosure/report split.

### PPOB Liability

PPOB liability aman jika:

- tidak memanggil `creditPpobBenefit()`
- wallet dibuat dengan `ppobBalance = 0`
- tidak membuat wallet transaction `PPOB_BENEFIT`

### Referral Engine

Referral engine bisa berjalan jika admin create user:

- membuat `referralCode` unique
- jika ada sponsor, membuat `referral`
- membuat `referralLevel` ancestor sampai level 10

### Commission Engine

Core commission berasal dari membership paid order downline. Founder Platinum sebagai upline akan menerima bonus jika:

- downline melakukan paid/approved membership
- Founder Platinum menjadi sponsor/upline
- tier Founder Platinum dibaca sebagai `PLATINUM`

Ini sesuai requirement.

## Apakah Bisa Tanpa Migration?

### Bisa secara teknis untuk UAT internal terbatas

Dengan script admin manual:

- create user
- create wallet cash=0 ppob=0
- assign `membershipId` ke PLATINUM
- create `UserMembership ACTIVE` tanpa orderId, metadata `{ source: "FOUNDER_PLATINUM" }`
- create referral relation jika sponsor ada
- create audit log

### Tidak direkomendasikan untuk production/public launch

Alasan:

1. Tidak ada constraint maksimal 10 founder.
2. Tidak ada field queryable untuk source.
3. Profit sharing tidak bisa filter Founder Platinum secara aman.
4. Membership report tidak bisa split Platinum paid vs Founder.
5. Compliance audit sulit karena source hanya JSON metadata.
6. Risiko admin salah memakai flow payment/order.

## Field yang Diperlukan Jika Migration

Rekomendasi minimal:

### Option A - Tambah enum/source pada UserMembership

```text
enum MembershipSource {
  REGISTRATION
  PAID_ORDER
  AUTO_UPGRADE
  ADMIN_GRANT
  FOUNDER_PLATINUM
}

user_memberships:
- source MembershipSource default PAID_ORDER
- granted_by uuid nullable
- granted_at timestamp nullable
- grant_reason text nullable
- founder_slot_number int nullable
- profit_sharing_eligible boolean default true
```

Constraint:

- unique partial index untuk `founder_slot_number` jika source `FOUNDER_PLATINUM`
- check founder_slot_number 1-10 bila source `FOUNDER_PLATINUM`

### Option B - Buat tabel khusus Founder Platinum Grants

```text
founder_platinum_grants:
- id
- user_id unique
- slot_number unique
- granted_by
- granted_at
- reason
- status ACTIVE/REVOKED
- profit_sharing_eligible default false
- metadata
```

Rekomendasi: **Option B lebih aman** karena fitur ini khusus 10 akun penghormatan dan tidak mengganggu semua user membership.

## Dampak ke Modul Penting

| Modul | Dampak | Mitigasi |
| --- | --- | --- |
| Revenue report | Aman jika tidak membuat order/invoice/payment. | Tambahkan report split Founder Platinum. |
| PPOB liability | Aman jika wallet ppobBalance tetap 0 dan tanpa PPOB_BENEFIT. | Test ppobBalance Founder = 0. |
| Wallet balance | Aman jika cashBalance awal 0. | Bonus future masuk cash lewat ledger normal. |
| Referral engine | Perlu create referral/referralLevel manual saat grant. | Reuse logic referral claim/create safely. |
| Commission engine | Founder terbaca Platinum dan berhak sponsor/level. | Pastikan source hanya memengaruhi grant, bukan tier eligibility. |
| Profit sharing | Risiko ikut payout Platinum. | Tambahkan `profitSharingEligible` false default untuk Founder sampai owner approve. |
| Google Play/Midtrans | Aman jika tidak dibuat invoice/payment palsu. | Disclosure internal bahwa Founder adalah admin grant, bukan purchase. |
| Admin audit | Butuh actor/reason/slot log. | Wajib AuditLog `FOUNDER_PLATINUM_GRANTED`. |

## Rekomendasi Flow Admin

1. Super Admin membuka menu Founder Platinum.
2. Input:
   - nama
   - phone
   - password awal
   - referral sponsor jika ada
   - founder slot 1-10
   - reason/note
3. Sistem validasi:
   - phone belum terdaftar
   - slot belum dipakai
   - sponsor referral code valid jika diisi
   - jumlah Founder aktif < 10
4. Sistem create user:
   - role USER
   - status ACTIVE
   - referralCode generated unique
   - membership PLATINUM
5. Sistem create wallet:
   - balance 0
   - cashBalance 0
   - ppobBalance 0
6. Sistem create `UserMembership ACTIVE`:
   - membership PLATINUM
   - orderId null
   - source/grant marker Founder Platinum
7. Sistem create referral genealogy jika sponsor ada.
8. Sistem create audit log.
9. Sistem tidak membuat:
   - invoice
   - membership order
   - payment
   - PPOB_BENEFIT transaction
   - revenue record

## Rekomendasi Implementasi Aman

1. Jangan memakai endpoint register publik.
2. Jangan memakai endpoint membership order/pay.
3. Buat service khusus `FounderPlatinumService`.
4. Batasi endpoint hanya `SUPER_ADMIN`.
5. Gunakan transaction serializable.
6. Generate referral code dengan retry dan unique check.
7. Simpan password hash dengan AuthService/password utility existing.
8. Buat `AuditLog` wajib.
9. Tambahkan unit/integration tests.
10. Jangan tampilkan Founder Platinum sebagai revenue.

## Test Wajib

1. Founder Platinum created:
   - user active
   - membership Platinum
   - wallet cash 0
   - ppob 0
   - no invoice/order/payment
2. Founder can sponsor paid Silver:
   - receives 8% sponsor bonus
3. Founder can receive level bonus:
   - receives up to Platinum level limits
4. Founder appears in referral tree.
5. Founder not counted as revenue.
6. Founder not included in PPOB liability.
7. Founder not included in profit sharing unless explicitly eligible.
8. Max 10 Founder active.
9. Duplicate phone blocked.
10. Duplicate slot blocked.

## Final Decision

**GO dengan migration nanti.**

Tidak disarankan GO tanpa migration untuk production karena pembeda source dan profit sharing eligibility belum aman. Tanpa migration hanya layak untuk simulasi lokal/UAT internal dengan script sementara, bukan public launch.
