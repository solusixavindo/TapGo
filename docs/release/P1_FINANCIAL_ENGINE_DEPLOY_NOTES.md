# TapGo P1 Financial Engine Deploy Notes

Date: 2026-06-09

## Migration Summary

Migration:

- `apps/backend/prisma/migrations/0012_financial_engine_p1_fix/migration.sql`

Main changes:

- Adds explicit wallet separation:
  - `wallets.cash_balance`
  - `wallets.ppob_balance`
- Keeps old `wallets.balance` for backward compatibility.
- Initializes `cash_balance` from existing `balance`.
- Initializes `ppob_balance` as `0`.
- Adds `reward_transactions` with status lifecycle:
  - `PENDING`
  - `APPROVED`
  - `PAID`
  - `REJECTED`
- Adds profit sharing formula fields:
  - `net_profit_amount`
  - `silver_allocation`
  - `gold_allocation`
  - `platinum_allocation`
  - `retained_amount`

## Risk Summary

### Historical PPOB Reclassification

Old production wallets did not have separate cash/PPOB balances. Migration treats historical `balance` as cash by copying it to `cash_balance`.

Reason:

- It avoids removing or freezing any existing user balance.
- PPOB historical reclassification requires separate ledger reconciliation and business approval.

### Rollback Coordination

After migration, backend code expects `cash_balance`, `ppob_balance`, and `reward_transactions`.

Rollback must coordinate:

- backend source rollback,
- database restore or schema rollback,
- PM2 restart.

### Reward Lifecycle

Reward threshold calculation is implemented, but reward payout lifecycle is intentionally not complete for production payout.

## Known Limitations

1. Reward admin lifecycle is not complete:
   - no final admin approve/reject/paid endpoints for `reward_transactions`.
   - reward is created as `PENDING`.
   - real cash credit should wait for `PAID` endpoint in a later phase.

2. Upgrade price final policy is not decided:
   - current behavior uses full target package price.
   - differential pricing needs a formal business decision.

3. Full reversal ledger is not implemented:
   - recommended future transaction types include `BONUS_REVERSAL`, `PPOB_REVERSAL`, `REWARD_REVERSAL`, and `PROFIT_SHARING_REVERSAL`.

## Why Safe For UAT

P1 is safe for UAT backend deployment because:

- migration is additive and non-destructive,
- old `balance` remains available,
- API can return `balance`, `cashBalance`, and `ppobBalance`,
- withdrawal is constrained to cash balance,
- PPOB benefit is separated from withdrawable cash for new transactions,
- backend test suite passed with 92 tests and 0 skipped in local/test DB,
- Flutter analyze/test passed before this deploy-preparation stage.

## Why Not Yet Full Production Reward Payout

Do not run real reward payout workflow in full production until:

- admin can list pending rewards,
- admin can approve/reject rewards,
- admin can mark approved rewards as paid,
- wallet cash credit is idempotently tied to `PAID`,
- audit/report screens can show reward lifecycle history.

## Manual Deploy Principle

This stage prepares deployment only. The operator must still:

- take a production database backup,
- take a source backup,
- deploy manually on VPS,
- run smoke tests,
- keep rollback available.

Reference checklist:

- `P1_FINANCIAL_ENGINE_VPS_DEPLOY_CHECKLIST.md`
