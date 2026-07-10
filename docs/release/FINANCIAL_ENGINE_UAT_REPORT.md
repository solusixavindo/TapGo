# TapGo Financial Engine UAT Report

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`  
Scope: UAT Phase A.5 - Financial Engine Verification

## Execution Mode

Audit mode: read-only production validation plus static source audit.  
No code changes, no migration, no deploy, no APK build, no production data mutation.

## Production Evidence

| Check | Endpoint | Result |
| --- | --- | --- |
| Health | `GET /health` | PASS, HTTP 200 |
| Wallet without token | `GET /api/v1/wallet` | PASS guard, HTTP 401 |
| Admin financial report without token | `GET /api/v1/admin/reports/financial-summary` | PASS guard, HTTP 401 |

## Financial Checks

| Item | Expected | Status | Notes |
| --- | --- | --- | --- |
| `cashBalance` | Present in wallet response | BLOCKED | Requires valid USER token. |
| `ppobBalance` | Present in wallet response | BLOCKED | Requires valid USER token. |
| `balance` compatibility | Present and maps to cash semantics | BLOCKED | Requires valid USER token. |
| cash != PPOB | Must be separated | BLOCKED | Requires user with wallet response. |
| Reward transaction | Pending/approved/paid lifecycle visible | BLOCKED | Requires ADMIN/SUPER_ADMIN token. |
| Commission transaction | Report/ledger visible | BLOCKED | Requires ADMIN/SUPER_ADMIN token. |
| Profit sharing transaction | Report visible | BLOCKED | Requires ADMIN/SUPER_ADMIN token. |

## Static / Prior Local Validation Context

Known from previous local/test validation:

- Migration 0012 dry-run PASS.
- Restore simulation PASS.
- Backend tests PASS: 94 tests, 0 skipped.
- P1 financial engine test suite PASS locally.

Production read-only limitation:

- No valid role token was available in this session.
- Production financial endpoints behind auth could not be verified with live data.

## Financial UAT Result

Overall status: BLOCKED ON AUTHENTICATED PRODUCTION DATA.

Additional risk:

- Public membership package endpoint shows `ppobBalance=0` for Silver/Gold/Platinum. This must be verified against actual activation/wallet behavior before Midtrans/Google Play finalization.
