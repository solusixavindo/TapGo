# TapGo Financial Admin Report

Date: 2026-06-11

## Endpoint Report

All endpoints are under `/api/v1/admin/reports` and protected by `ADMIN` / `SUPER_ADMIN`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/reports/financial-summary` | High-level financial summary |
| `GET` | `/api/v1/admin/reports/wallet-liability` | Cash/PPOB wallet liability |
| `GET` | `/api/v1/admin/reports/commission-summary` | Sponsor, level, reward, profit sharing commission totals |
| `GET` | `/api/v1/admin/reports/reward-summary` | Reward totals by status |
| `GET` | `/api/v1/admin/reports/profit-sharing-summary` | Profit sharing pool/allocation/paid summary |
| `GET` | `/api/v1/admin/reports/ppob-summary` | PPOB benefit and liability summary |

Supported date query aliases:

- `dateFrom`
- `dateTo`
- `startDate`
- `endDate`

## Field Response

### Financial Summary

- `totalCashWalletLiability`
- `totalPpobLiability`
- `totalSponsorBonus`
- `totalLevelBonus`
- `totalRewardPending`
- `totalRewardApproved`
- `totalRewardPaid`
- `totalProfitSharing`
- `totalWithdrawalPending`
- `totalWithdrawalPaidApproved`
- `totalMembershipRevenuePaid`
- `totalActiveBasic`
- `totalActiveSilver`
- `totalActiveGold`
- `totalActivePlatinum`

### Wallet Liability

- `totalCashBalance`
- `totalPpobBalance`
- `totalWithdrawableBalance`
- `totalNonWithdrawablePpob`
- `usersWithCashBalance`
- `usersWithPpobBalance`

### Commission Summary

- `sponsorBonusTotal`
- `levelBonusTotal`
- `rewardBonusTotal`
- `profitSharingTotal`
- `period`

### Reward Summary

- `countPending`
- `countApproved`
- `countPaid`
- `countRejected`
- `totalPending`
- `totalApproved`
- `totalPaid`
- `totalRejected`
- `period`

### Profit Sharing Summary

- `totalNetProfitInput`
- `totalPoolAmount`
- `totalSilverAllocation`
- `totalGoldAllocation`
- `totalPlatinumAllocation`
- `totalRetainedUndistributed`
- `totalPaid`
- `period`

### PPOB Summary

- `basicRegistrationPpobTotal`
- `silverPpobTotal`
- `goldPpobTotal`
- `platinumPpobTotal`
- `unknownPackagePpobTotal`
- `packagePpobBenefitTotal`
- `totalPpobLiability`
- `totalNonWithdrawablePpob`
- `period`

## Definisi Liability

Cash wallet liability:

- Total saldo cash yang bisa ditarik member.
- Source: `wallets.cash_balance`.

PPOB liability:

- Total saldo PPOB benefit yang belum dipakai.
- Source: `wallets.ppob_balance`.
- Tidak boleh ditarik via withdrawal.

## Definisi Withdrawable vs Non-Withdrawable

Withdrawable:

- `cashBalance`.
- Sponsor bonus.
- Level bonus.
- Paid reward bonus.
- Profit sharing paid.

Non-withdrawable:

- `ppobBalance`.
- Basic PPOB registration benefit.
- Silver/Gold/Platinum PPOB package benefit.

## Test Coverage

Integration coverage:

- `apps/backend/tests/admin-console/adminConsole.integration.test.ts`

Scenarios:

- USER access to financial report returns `403`.
- ADMIN access returns `200`.
- SUPER_ADMIN access returns `200`.
- Cash and PPOB liability are separated.
- PPOB is not counted as withdrawable balance.
- Reward status summary counts and sums pending reward.
- Profit sharing summary uses net profit, pool, allocations, and paid distribution.
- Membership revenue paid is calculated from paid invoices.

## Test Result

Previous blocker:

- PostgreSQL test database was not reachable at `localhost:5433`.

Resolution:

- Docker PostgreSQL was started from `infra/docker-compose.yml`.
- Test DB `tapgo_test` was recreated and migrated.
- `TEST_DATABASE_SETUP.md` documents Docker and local PostgreSQL setup.

Validation results:

| Check | Result |
| --- | --- |
| Targeted admin + P1 financial integration | PASS, 6 files, 19 tests |
| Full backend test suite | PASS, 14 files, 94 tests, 0 skipped |
| Backend build | PASS |
| Prisma validate | PASS |
| Prisma generate | PASS |

Targeted command used from `apps/backend`:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public \
npx vitest run \
  tests/admin-console/adminConsole.integration.test.ts \
  tests/business-engine/ppobWalletSeparation.integration.test.ts \
  tests/business-engine/rewardEngineFinal.integration.test.ts \
  tests/business-engine/profitSharingFinal.integration.test.ts \
  tests/business-engine/upgradeFinancialFlow.integration.test.ts \
  tests/business-engine/refundReversalAudit.integration.test.ts
```

Important:

- Run targeted backend tests from `apps/backend` so Vitest loads `apps/backend/vitest.config.ts`.
- That config disables file parallelism to prevent shared integration DB race conditions.
