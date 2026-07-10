# Reward & Profit Sharing Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only reward milestone, admin reward lifecycle, profit sharing formula, dan idempotency.

## Ringkasan

Status: **PASS dengan WARNING**

Reward final sudah dibuat sebagai `RewardTransaction` PENDING berdasarkan direct active Silver dan tidak langsung masuk wallet. Admin dapat approve, reject, dan mark paid. Mark paid membuat ledger cash `REWARD_BONUS`.

Profit sharing memakai input `netProfitAmount`, pool 60%, alokasi Silver 30%, Gold 20%, Platinum 10%, sisanya retained/undistributed. Distribusi hanya dari period APPROVED dan period sama unique.

WARNING utama: engine lama `CommissionEngine.ts` masih memiliki reward lama untuk Platinum 10 direct sponsor. Jalur utama sudah benar, tapi file lama harus diperlakukan legacy.

## Evidence Source

- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:20` sampai `26`: reward milestone 10/100/1000/10000/100000.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:821` sampai `885`: reward PENDING berdasarkan direct active Silver.
- `apps/backend/prisma/schema.prisma:674` sampai `699`: model `RewardTransaction`, status PENDING/APPROVED/PAID/REJECTED, unique `[userId, referenceType, referenceId]`.
- `apps/backend/src/modules/admin-console/application/AdminConsoleService.ts:337` sampai `470`: approve/reject/mark-paid reward.
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts:8` sampai `31`: formula net profit -> pool/alokasi.
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts:85` sampai `171`: distribute approved period.
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts:174` sampai `270`: post distribution ke wallet cash dan commission ledger.

## Reward Matrix

| Rule | Implementasi | Status |
| --- | --- | --- |
| 10 Silver aktif langsung = Rp500.000 | Milestone threshold 10 amount 500000 | PASS |
| 100 Silver aktif langsung = Rp5.000.000 | Milestone threshold 100 amount 5000000 | PASS |
| 1.000 Silver aktif langsung = Rp50.000.000 | Milestone threshold 1000 amount 50000000 | PASS |
| 10.000 Silver aktif langsung = Rp500.000.000 | Milestone threshold 10000 amount 500000000 | PASS |
| 100.000 Silver aktif langsung = Rp5.000.000.000 | Milestone threshold 100000 amount 5000000000 | PASS |
| Hanya direct active Silver | Count referral ACTIVE + sponsored user membership SILVER + userMembership ACTIVE SILVER | PASS |
| Tidak double threshold sama | Unique reward user/reference | PASS |
| Reward dibuat PENDING dulu | `status: "PENDING"` | PASS |
| Reward paid masuk cash | Admin `markRewardPaid` increment `balance` dan `cashBalance` | PASS |

## Profit Sharing Matrix

| Rule | Implementasi | Status |
| --- | --- | --- |
| Input net profit | `createPeriod(netProfitAmount)` | PASS |
| Pool 60% | `netProfitAmount.mul(60).div(100)` | PASS |
| Silver 30% dari pool | `poolAmount.mul(30).div(100)` | PASS |
| Gold 20% dari pool | `poolAmount.mul(20).div(100)` | PASS |
| Platinum 10% dari pool | `poolAmount.mul(10).div(100)` | PASS |
| Retained/undistributed | `totalPoolAmount.minus(allocatedPaid)` | PASS |
| Silver qualified minimal 3 direct active Silver | `findSilverQualifiedMembers` menghitung direct active Silver | PASS |
| Gold/Platinum tidak wajib sponsor | `findActiveMembersByTier` | PASS |
| Period sama tidak double | unique `[periodMonth, periodYear]`, distribute hanya APPROVED, distribution unique `[periodId, userId]` | PASS |

## Risiko

| Temuan | Risiko | Prioritas |
| --- | --- | --- |
| Reward lama masih ada di `CommissionEngine.ts` | Bisa dipakai ulang secara keliru | P1 |
| Profit sharing adalah fitur finansial sensitif | Perlu SOP approval, audit trail, dan bukti net profit sebelum public payout | P1 |
| Tidak terlihat reversal ledger penuh untuk reward/profit sharing setelah paid | Jika ada sengketa setelah paid, rollback butuh prosedur manual | P1 |

## Kesimpulan

Reward dan profit sharing siap untuk UAT backend/admin. Untuk public payout, wajib ada SOP approval, dokumen sumber net profit, dan prosedur reversal manual/ledger sebelum dana benar-benar dibayarkan massal.

