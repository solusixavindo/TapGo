# TapGo Production Smoke Test Report

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`  
Scope: Post-deploy smoke test for P1 Financial Engine

## Status Eksekusi

Status: NOT EXECUTED FROM CODEX SESSION.

Reason:

- Backend deployment has not been executed from this session.
- Smoke test must run after VPS backup, migration, build, and PM2 restart.
- No production token or credentials were provided in this workspace.

## Smoke Test Command

Health-only smoke test:

```bash
API_BASE_URL=https://api.tapgolion.id ./scripts/smoke-test-p1-financial.sh
```

Authenticated user wallet + user admin guard test:

```bash
API_BASE_URL=https://api.tapgolion.id \
TAPGO_USER_PHONE="<USER_PHONE>" \
TAPGO_USER_PASSWORD="<USER_PASSWORD>" \
TAPGO_EXPECT_ADMIN_FORBIDDEN=1 \
./scripts/smoke-test-p1-financial.sh
```

Admin and Super Admin report/reward smoke test:

```bash
API_BASE_URL=https://api.tapgolion.id \
TAPGO_ADMIN_PHONE="080000000002" \
TAPGO_ADMIN_PASSWORD="<ADMIN_PASSWORD>" \
TAPGO_SUPER_ADMIN_PHONE="080000000001" \
TAPGO_SUPER_ADMIN_PASSWORD="<SUPER_ADMIN_PASSWORD>" \
./scripts/smoke-test-p1-financial.sh
```

Full smoke test with all roles:

```bash
API_BASE_URL=https://api.tapgolion.id \
TAPGO_USER_PHONE="<USER_PHONE>" \
TAPGO_USER_PASSWORD="<USER_PASSWORD>" \
TAPGO_ADMIN_PHONE="080000000002" \
TAPGO_ADMIN_PASSWORD="<ADMIN_PASSWORD>" \
TAPGO_SUPER_ADMIN_PHONE="080000000001" \
TAPGO_SUPER_ADMIN_PASSWORD="<SUPER_ADMIN_PASSWORD>" \
TAPGO_EXPECT_ADMIN_FORBIDDEN=1 \
./scripts/smoke-test-p1-financial.sh
```

## Endpoint Checklist

| No | Endpoint / Check | Expected | Actual | Status |
| ---: | --- | --- | --- | --- |
| 1 | `GET /health` | `200` | Pending | Pending |
| 2 | `GET /api/v1/health` | `200` or documented non-authoritative status | Pending | Pending |
| 3 | `POST /api/v1/auth/login` Super Admin | `200`, token present | Pending | Pending |
| 4 | `POST /api/v1/auth/login` Admin | `200`, token present | Pending | Pending |
| 5 | `POST /api/v1/auth/login` User | `200`, token present | Pending | Pending |
| 6 | `GET /api/v1/wallet` | `balance`, `cashBalance`, `ppobBalance` present | Pending | Pending |
| 7 | `GET /api/v1/wallet/transactions?page=1&pageSize=5` | `200` | Pending | Pending |
| 8 | USER `GET /api/v1/admin/dashboard/summary` | `403` | Pending | Pending |
| 9 | ADMIN `GET /api/v1/admin/dashboard/summary` | `200` | Pending | Pending |
| 10 | ADMIN `GET /api/v1/admin/rewards` | `200` | Pending | Pending |
| 11 | ADMIN `GET /api/v1/admin/reports/financial-summary` | `200` | Pending | Pending |
| 12 | SUPER_ADMIN `GET /api/v1/admin/dashboard/summary` | `200` | Pending | Pending |
| 13 | SUPER_ADMIN `GET /api/v1/admin/rewards` | `200` | Pending | Pending |
| 14 | SUPER_ADMIN `GET /api/v1/admin/reports/financial-summary` | `200` | Pending | Pending |

## Manual Withdraw Cash-Only Check

Use only a dedicated UAT account.

Goal:

- Withdrawal must use `cashBalance`.
- PPOB balance must not be withdrawable.

Recommended non-destructive first check:

```bash
curl -s https://api.tapgolion.id/api/v1/wallet \
  -H "Authorization: Bearer <USER_TOKEN>"
```

Expected:

- `cashBalance` visible.
- `ppobBalance` visible.
- If `cashBalance = 0` and `ppobBalance > 0`, withdrawal request should be rejected for insufficient cash balance.

Do not run real withdrawal smoke test on a production user unless the account is explicitly approved for UAT.

## Smoke Test Result

Current result: PENDING.

APK build gate:

- Do not build APK until this report is updated to PASS after actual production deployment.
