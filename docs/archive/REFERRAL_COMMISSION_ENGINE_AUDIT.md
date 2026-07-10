# Referral Commission Engine Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only referral, sponsor bonus, level bonus, genealogy, idempotency, dan risiko engine lama.

## Ringkasan

Status: **PASS dengan WARNING**

Flow utama referral dan komisi sudah berada di jalur yang benar:

1. Register hanya membuat genealogy referral.
2. Sponsor bonus tidak dibayar saat register.
3. Sponsor bonus dibayar saat membership order paid/approved.
4. Basic sponsor mendapat Rp2.000.
5. Silver/Gold/Platinum sponsor mendapat 8% dari paket.
6. Level bonus dibatasi tier: Silver 3 level, Gold 5 level, Platinum 10 level.
7. Idempotency ditopang unique constraint commission.

WARNING utama: `CommissionEngine.ts` lama masih memiliki rule reward lama `platinum.10_direct_sponsors`. Jalur payment utama sekarang memakai `MembershipOrderService`, tetapi kelas lama ini masih dites dan dapat membingungkan perubahan berikutnya.

## Evidence Source

- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts:85` sampai `120`: register referral membuat `referral` dan `referralLevel`, lalu komentar eksplisit bahwa sponsor bonus dibayar dari paid membership approval flow.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:562` sampai `686`: sponsor bonus final.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:688` sampai `819`: level bonus final.
- `apps/backend/prisma/schema.prisma:421` sampai `448`: model `Commission` memiliki unique constraint `[beneficiaryId, triggerType, triggerId, type, level]`.
- `apps/backend/prisma/schema.prisma:387` sampai `419`: `Referral` dan `ReferralLevel` menyimpan sponsor langsung dan genealogy level.

## Sponsor Bonus

| Rule | Implementasi | Status |
| --- | --- | --- |
| Tidak dibayar saat register | Register hanya membuat genealogy | PASS |
| Hanya saat membership paid/approved | Bonus dipanggil dalam `markPaymentSuccess` setelah invoice/order/payment paid | PASS |
| Sponsor Basic mendapat Rp2.000 | `isBasicSponsor ? basicSponsorBonusAmount : 8%` | PASS |
| Sponsor non-Basic mendapat 8% | `packagePrice.mul(8).div(100)` | PASS |
| Basic package tidak memicu bonus | `if packageTier === BASIC return` | PASS |
| Idempotent | Cek `commission.findUnique` per trigger/order/type/level | PASS |

## Level Bonus

| Tier Upline | Rule Final | Implementasi | Status |
| --- | --- | --- | --- |
| Basic | 0 level | `levelLimitByTier.BASIC = 0` | PASS |
| Silver | Level 1-3 | `levelLimitByTier.SILVER = 3` | PASS |
| Gold | Level 1-5 | `levelLimitByTier.GOLD = 5` | PASS |
| Platinum | Level 1-10 | `levelLimitByTier.PLATINUM = 10` | PASS |
| Rate | 8%, 4%, 2%, 2%, 2%, 1% x5 | `levelBonusRates` level 1-10 | PASS |
| Idempotent | Unique commission per beneficiary/order/type/level | PASS |

## Referral Tree

Status: **PASS**

Register dengan referral code membuat:

- direct `referral` dengan `sponsorId` dan `userId`.
- closure/genealogy di `referralLevel` level 1 sampai maksimum 10.
- unique constraint `[ancestorId, descendantId]` mencegah duplicate genealogy.

## Warning

| Temuan | Risiko | Prioritas |
| --- | --- | --- |
| `apps/backend/src/modules/referrals/application/CommissionEngine.ts:126` sampai `148` masih punya reward lama untuk Platinum + 10 direct sponsor | Developer bisa salah memakai engine lama dan menghasilkan reward yang tidak sesuai rule final | P1 |
| `CommissionEngine.ts:150` masih punya `calculateProfitSharingPlaceholder()` | Bukan jalur utama saat ini, tetapi menandakan engine lama belum dibersihkan | P2 |
| `apps/backend/tests/referrals/commissionEngine.test.ts` masih menguji reward lama | Test bisa memberi rasa aman palsu untuk rule lama | P1 |

## Kesimpulan

Jalur utama referral/commission yang dipakai membership payment sudah sesuai untuk UAT/Closed Testing. Sebelum public launch, rekomendasi P1 adalah menandai `CommissionEngine.ts` sebagai legacy atau menyelaraskan/menghapus rule lama agar tidak dipakai ulang.

