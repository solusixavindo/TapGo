# TapGo Pre-Deployment Final Readiness

Date: 2026-06-11

## Executive Status

Status: READY FOR MANUAL VPS DEPLOYMENT, with backup-first process.

Previous blockers have been resolved:

- Backend integration test was blocked because PostgreSQL test DB `localhost:5433` was not reachable.
- Migration dry-run was blocked because local PostgreSQL CLI tools were missing and Docker was not active.

Fix applied:

- Docker Desktop was started.
- `infra/docker-compose.yml` PostgreSQL and Redis services were started.
- Test DB `tapgo_test` was recreated on Docker PostgreSQL.
- `TEST_DATABASE_SETUP.md` now documents Docker and local PostgreSQL setup.
- `scripts/dry-run-migration-0012.sh` now supports Docker mode and non-Docker local PostgreSQL mode.
- Reward 1000-direct-Silver integration test timeout was raised to avoid false timeout on the heavy validation case.

## 1. Reward Lifecycle Readiness

Status: READY FOR UAT BACKEND DEPLOYMENT.

Implemented backend endpoints:

- `GET /api/v1/admin/rewards`
- `GET /api/v1/admin/rewards/:id`
- `POST /api/v1/admin/rewards/:id/approve`
- `POST /api/v1/admin/rewards/:id/reject`
- `POST /api/v1/admin/rewards/:id/mark-paid`

Implemented state machine:

- `PENDING -> APPROVED`
- `PENDING -> REJECTED`
- `APPROVED -> PAID`
- duplicate `PAID` action does not duplicate wallet ledger.

Cash movement:

- Reward cash wallet credit happens only on `mark-paid`.
- Wallet ledger type: `REWARD_BONUS`.

Validation:

- Targeted admin console integration: PASS, 4 tests.
- Targeted admin + P1 financial integration suite: PASS, 6 files, 19 tests.
- Full backend suite: PASS, 14 files, 94 tests, 0 skipped.

## 2. Financial Admin Report Readiness

Status: READY FOR UAT BACKEND DEPLOYMENT.

Implemented endpoints:

- `GET /api/v1/admin/reports/financial-summary`
- `GET /api/v1/admin/reports/wallet-liability`
- `GET /api/v1/admin/reports/commission-summary`
- `GET /api/v1/admin/reports/reward-summary`
- `GET /api/v1/admin/reports/profit-sharing-summary`
- `GET /api/v1/admin/reports/ppob-summary`

All endpoints are protected by ADMIN/SUPER_ADMIN role guard.

Validation:

- USER role rejected from protected admin endpoints with `403`.
- ADMIN/SUPER_ADMIN report access returned `200`.
- Cash and PPOB liability fields validated.
- Reward, profit sharing, PPOB, and membership revenue summaries validated.

## 3. Migration Dry Run Readiness

Status: PASS.

Script:

- `scripts/dry-run-migration-0012.sh`

Command used:

```bash
TAPGO_DRY_RUN_USE_DOCKER=YES TAPGO_DRY_RUN_CONFIRM=YES ./scripts/dry-run-migration-0012.sh
```

Dry-run result:

- Applied migrations `0001` through `0011` to a temporary dry-run DB.
- Seeded legacy wallet data.
- Created backup with `pg_dump`.
- Applied `0012_financial_engine_p1_fix`.
- Validated `wallets.balance` retained.
- Validated `cash_balance` copied from legacy `balance`.
- Validated `ppob_balance` defaults to `0`.
- Validated legacy wallet transactions and withdrawal remain readable.
- Validated `reward_transactions` exists.
- Simulated restore from backup.
- Validated restored DB returns to pre-0012 shape.
- Dropped dry-run DB after success.

## 4. Test Summary

| Check | Status | Notes |
| --- | --- | --- |
| Test DB setup | PASS | Docker PostgreSQL `tapgo-postgres`, port `5433` |
| Targeted admin/financial integration | PASS | 6 files, 19 tests |
| Backend full test | PASS | 14 files, 94 tests, 0 skipped |
| Migration dry-run | PASS | Includes restore simulation |
| Backend build | PASS | `npm --workspace apps/backend run build` |
| Prisma validate | PASS | Schema valid |
| Prisma generate | PASS | Prisma Client generated |
| Flutter analyze | PASS | No issues found |
| Flutter test | PASS | 7 tests passed |
| APK build | Not run | By instruction |

## 5. Remaining Risk

P1 operational risk:

- Reward admin UI workflow still needs UAT even though backend lifecycle is ready.
- Reward lifecycle stores admin IDs/reasons in metadata, not dedicated columns.
- Upgrade price is still full package price for UAT until final business decision is approved.
- Full reversal ledger for paid membership cancellation is documented but not fully implemented.

Deployment risk:

- VPS deploy must be backup-first.
- Do not run seed/demo commands on production.
- Run production smoke tests immediately after migration and PM2 restart.

## 6. Apakah Aman Deploy Backend VPS?

Yes, for manual UAT backend deployment, provided these conditions are followed:

1. Take PostgreSQL production backup first.
2. Backup `/var/www/Tapgo` source folder first.
3. Run `npx prisma migrate deploy`.
4. Run backend build.
5. Restart `tapgo-api` with PM2.
6. Run smoke tests for health, wallet fields, admin reports, reward lifecycle, and withdrawal cash-only behavior.

## 7. Apakah Aman Build APK UAT Setelah Deploy?

Yes, after VPS deployment and smoke tests pass.

APK build was intentionally not run in this stage.
