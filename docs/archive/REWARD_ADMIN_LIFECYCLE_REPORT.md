# TapGo Reward Admin Lifecycle Report

Date: 2026-06-11

## Endpoint Yang Dibuat

All endpoints are under `/api/v1/admin` and protected by `ADMIN` / `SUPER_ADMIN` role guard.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/rewards` | List reward transactions |
| `GET` | `/api/v1/admin/rewards/:id` | Reward detail |
| `POST` | `/api/v1/admin/rewards/:id/approve` | Approve pending reward |
| `POST` | `/api/v1/admin/rewards/:id/reject` | Reject pending reward |
| `POST` | `/api/v1/admin/rewards/:id/mark-paid` | Mark approved reward as paid and credit cash wallet |

## State Machine Reward

Allowed transitions:

| From | Action | To | Cash Ledger |
| --- | --- | --- | --- |
| `PENDING` | approve | `APPROVED` | No |
| `PENDING` | reject | `REJECTED` | No |
| `APPROVED` | mark-paid | `PAID` | Yes, `REWARD_BONUS` |
| `PAID` | mark-paid | `PAID` | No duplicate ledger |

Blocked transitions:

- `REJECTED -> PAID`
- `PAID -> REJECTED`
- `REJECTED -> APPROVED`
- `APPROVED -> REJECTED`

## Role Guard

The admin console router applies:

```ts
requireAuth, requireRoles("ADMIN", "SUPER_ADMIN")
```

Therefore:

- `USER` receives `403`.
- `ADMIN` can operate reward lifecycle.
- `SUPER_ADMIN` can operate reward lifecycle.

## Ledger Architecture

Reward threshold detection creates `reward_transactions` with:

- `status = PENDING`
- no wallet cash movement
- no wallet transaction

Cash wallet is credited only when admin marks an approved reward as `PAID`.

On `mark-paid`:

- wallet is upserted if needed,
- `wallets.balance` increments,
- `wallets.cash_balance` increments,
- `wallet_transactions` receives type `REWARD_BONUS`,
- `reward_transactions.wallet_transaction_id` is linked.

Duplicate `mark-paid` returns existing paid reward and does not create a second ledger row.

## Test Coverage

Integration coverage:

- `apps/backend/tests/admin-console/adminConsole.integration.test.ts`
- `apps/backend/tests/business-engine/rewardEngineFinal.integration.test.ts`

Scenarios:

- USER access to reward admin endpoint returns `403`.
- Admin can list pending rewards.
- Admin can approve pending reward.
- Admin can reject pending reward.
- Admin can mark approved reward as paid.
- Paid reward does not create duplicate ledger on repeated mark-paid.
- Paid reward cannot be rejected.
- Rejected reward cannot be approved.
- 9 direct active Silver does not create reward.
- 10/100/1000 direct active Silver thresholds create PENDING reward once.
- Basic/Pending direct referrals are ignored.
- Old Platinum plus 10 Basic rule is disabled.

## Test Result

Previous blocker:

- PostgreSQL test database was not reachable at `localhost:5433`.
- Heavy 1000-direct-Silver reward validation exceeded Vitest default 5s timeout on this MacBook.

Resolution:

- Docker PostgreSQL was started from `infra/docker-compose.yml`.
- Test DB `tapgo_test` was recreated and migrated.
- Reward 1000-direct-Silver test timeout was raised to 30s.

Validation results:

| Check | Result |
| --- | --- |
| Targeted admin + P1 financial integration | PASS, 6 files, 19 tests |
| Full backend test suite | PASS, 14 files, 94 tests, 0 skipped |
| Backend build | PASS |
| Prisma validate | PASS |
| Prisma generate | PASS |

## Remaining Gap

No Flutter UI was added for reward approval in this stage.

Backend lifecycle is implemented, but production reward payout should still wait for:

- final admin workflow/UAT approval,
- audit log review if the business wants explicit admin action logs beyond reward metadata.
