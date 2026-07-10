# TapGo Business Engine P1 Financial Fix Report

Date: 2026-06-09

## 1. Executive Summary

P1 financial engine gaps have been implemented and validated on the local/test database only.

No UI premium, dashboard, login, production endpoint, VPS, APK, or production database was changed.

Status:

- Cash wallet and PPOB balance are separated.
- Withdrawal uses cash balance only.
- Basic registration Rp5.000 now credits PPOB balance only for the first 1.000 users.
- Silver/Gold/Platinum PPOB benefits credit PPOB balance only.
- Sponsor bonus, level bonus, and profit sharing credit cash wallet.
- Reward engine now uses final direct active Silver thresholds and creates pending reward records.
- Profit sharing now uses net profit formula and qualified tier distribution.
- Upgrade financial flow and refund/reversal risks are documented.
- Backend integration test: 92 passed, 0 skipped.

Production readiness score after this P1 fix: 86%.

## 2. File Yang Diubah

Backend source:

- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts`
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
- `apps/backend/src/modules/memberships/infrastructure/PrismaMembershipRepository.ts`
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`
- `apps/backend/src/modules/profit-sharing/presentation/profit-sharing.controller.ts`
- `apps/backend/src/modules/profit-sharing/presentation/profit-sharing.validators.ts`
- `apps/backend/src/modules/referrals/infrastructure/PrismaReferralRepository.ts`
- `apps/backend/src/modules/wallets/domain/WalletRepository.ts`
- `apps/backend/src/modules/wallets/infrastructure/PrismaWalletRepository.ts`
- `apps/backend/src/modules/admin-console/application/AdminConsoleService.ts`
- `apps/backend/vitest.config.ts`

Migration:

- `apps/backend/prisma/migrations/0012_financial_engine_p1_fix/migration.sql`

Tests:

- `apps/backend/tests/business-engine/ppobWalletSeparation.integration.test.ts`
- `apps/backend/tests/business-engine/rewardEngineFinal.integration.test.ts`
- `apps/backend/tests/business-engine/profitSharingFinal.integration.test.ts`
- `apps/backend/tests/business-engine/upgradeFinancialFlow.integration.test.ts`
- `apps/backend/tests/business-engine/refundReversalAudit.integration.test.ts`
- Existing tests updated for final cash/PPOB separation and reward/profit sharing rules.

Reports:

- `UPGRADE_FINANCIAL_FLOW.md`
- `REFUND_REVERSAL_AUDIT.md`
- `BUSINESS_ENGINE_P1_FINANCIAL_FIX_REPORT.md`

## 3. Migration Yang Dibuat

Migration `0012_financial_engine_p1_fix`:

- Adds `wallets.cash_balance`.
- Adds `wallets.ppob_balance`.
- Preserves old `wallets.balance` as cash-compatible alias.
- Adds reward status enum `RewardTransactionStatus`.
- Adds `reward_transactions`.
- Adds profit sharing formula fields:
  - `net_profit_amount`
  - `silver_allocation`
  - `gold_allocation`
  - `platinum_allocation`
  - `retained_amount`

Migration was applied only to local/test database.

## 4. Wallet Cash vs PPOB Implementation

Final behavior:

| Transaction | Cash Balance | PPOB Balance | Withdrawable |
| --- | ---: | ---: | --- |
| Basic registration first 1.000 users | Rp0 | +Rp5.000 | No |
| Basic registration user 1.001+ | Rp0 | Rp0 | No |
| Silver PPOB benefit | Rp0 | +Rp100.000 | No |
| Gold PPOB benefit | Rp0 | +Rp600.000 | No |
| Platinum PPOB benefit | Rp0 | +Rp1.000.000 | No |
| Sponsor bonus | +cash | Rp0 | Yes |
| Level bonus | +cash | Rp0 | Yes |
| Profit sharing | +cash | Rp0 | Yes |
| Withdrawal request | -cash | Rp0 | Cash only |

Backward compatibility:

- API can still expose `balance`.
- Internally `balance` is kept aligned with cash balance.
- New explicit fields are available: `cashBalance`, `ppobBalance`.

## 5. Reward Engine Final Implementation

Old rule disabled:

- Platinum + 10 generic direct referrals.

Final rule implemented:

| Direct Active Silver | Reward |
| ---: | ---: |
| 10 | Rp500.000 |
| 100 | Rp5.000.000 |
| 1.000 | Rp50.000.000 |
| 10.000 | Rp500.000.000 |
| 100.000 | Rp5.000.000.000 |

Reward is created as `reward_transactions` with status `PENDING`.

No cash wallet credit is posted until a future explicit reward approval/paid flow is implemented. This avoids paying rewards before admin verification.

Idempotency:

- Unique key: `userId + referenceType + referenceId`.
- Same threshold cannot be created twice.

## 6. Profit Sharing Final Implementation

Input:

- `netProfitAmount`

Formula:

- `poolAmount = netProfitAmount * 60%`
- `silverAllocation = poolAmount * 30%`
- `goldAllocation = poolAmount * 20%`
- `platinumAllocation = poolAmount * 10%`
- unpaid category allocation is retained.

Eligibility:

- Silver qualified: active Silver with at least 3 direct active Silver.
- Gold qualified: active Gold.
- Platinum qualified: active Platinum.

Idempotency:

- Period already `DISTRIBUTED` cannot be distributed again.
- User cannot receive twice for the same period.

## 7. Upgrade Financial Flow Audit

Current behavior:

- All upgrades use full target package price.
- No differential upgrade price is implemented yet.
- Downgrade is blocked.
- Pending orders do not trigger financial payout.

Open decision:

- Silver -> Gold: full Rp3.000.000 or difference Rp2.500.000.
- Gold -> Platinum: full Rp5.500.000 or difference Rp2.500.000.

See `UPGRADE_FINANCIAL_FLOW.md`.

## 8. Refund / Reversal Audit

Implemented guard:

- `PAID` membership order cannot be rejected through pending-order rejection flow.
- Duplicate withdrawal refund is blocked.

Not yet implemented:

- Full payment refund/reversal engine.
- Bonus/PPOB/reward/profit sharing reversal ledger types.

Recommended future ledger types:

- `BONUS_REVERSAL`
- `PPOB_REVERSAL`
- `REWARD_REVERSAL`
- `PROFIT_SHARING_REVERSAL`

See `REFUND_REVERSAL_AUDIT.md`.

## 9. Expected vs Actual Matrix

| Rule | Expected | Actual | Status |
| --- | --- | --- | --- |
| Basic first 1.000 | PPOB Rp5.000, cash Rp0 | PPOB Rp5.000, cash Rp0 | PASS |
| Basic 1.001+ | PPOB Rp0, cash Rp0 | PPOB Rp0, cash Rp0 | PASS |
| Silver benefit | PPOB +Rp100.000, cash unchanged | PPOB +Rp100.000, cash unchanged | PASS |
| Gold benefit | PPOB +Rp600.000 | PPOB +Rp600.000 | PASS |
| Platinum benefit | PPOB +Rp1.000.000 | PPOB +Rp1.000.000 | PASS |
| Withdrawal | Cash only | Cash only | PASS |
| 9 Silver direct | No reward | No reward | PASS |
| 10 Silver direct | Reward Rp500.000 pending | Reward Rp500.000 pending | PASS |
| 100 Silver direct | Reward Rp5.000.000 pending | Reward Rp5.000.000 pending | PASS |
| 1.000 Silver direct | Reward Rp50.000.000 pending | Reward Rp50.000.000 pending | PASS |
| Platinum + 10 Basic direct | No reward | No reward | PASS |
| Profit sharing Rp100M net profit | Pool Rp60M, Silver Rp18M, Gold Rp12M, Platinum Rp6M | Match | PASS |
| Profit sharing duplicate | Rejected | Rejected | PASS |
| Paid membership reject | Rejected without reversal flow | Rejected | PASS |

## 10. Test Result

Backend integration/unit tests:

- Command: `npm --workspace apps/backend run test`
- Result: 14 test files passed, 92 tests passed, 0 skipped.

Backend build:

- Command: `npm --workspace apps/backend run build`
- Result: PASS.

Prisma validation:

- Command: `npx prisma validate --schema apps/backend/prisma/schema.prisma`
- Result: PASS.

Prisma generate:

- Command: `npx prisma generate --schema apps/backend/prisma/schema.prisma`
- Result: PASS.

Migration test database:

- Command: `npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma`
- Result: migration `0012_financial_engine_p1_fix` applied to test DB only.

## 11. Remaining Gap

P1 remaining:

- None for requested P1 scope.

P2:

- Reward approval/paid admin endpoint and UI.
- Full refund/reversal engine with append-only reversal ledger.
- Final decision for full-price vs differential-price upgrade.

P3:

- Admin report labels can distinguish cash vs PPOB more explicitly in UI later.

## 12. Production Readiness Score

Current backend financial readiness score: 86%.

Reason:

- Core P1 financial separation and final formulas are implemented and tested.
- Remaining risk is mainly operational flow around reward approval and reversal lifecycle, not the core earning formulas.

## 13. Apakah Sudah Boleh Lanjut APK UAT?

Yes, boleh lanjut ke APK UAT after backend validation commands stay green.

Do not deploy to production until:

- migration review is approved,
- database backup is prepared,
- reward approval/reversal operational policy is accepted,
- staged smoke test passes.
