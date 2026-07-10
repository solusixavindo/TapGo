# TapGo USER UAT Report

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`  
Scope: UAT Phase A.1 - User Role

## Execution Mode

Audit mode: read-only production validation plus static source audit.  
No code changes, no migration, no deploy, no APK build, no production data mutation.

## Production Endpoint Evidence

| Check | Endpoint | Result |
| --- | --- | --- |
| Backend health | `GET /health` | PASS, HTTP 200 |
| API v1 health | `GET /api/v1/health` | PASS, HTTP 200 |
| Public packages | `GET /api/v1/membership/packages` | PASS, HTTP 200 |
| Wallet without token | `GET /api/v1/wallet` | PASS guard, HTTP 401 `AUTH_TOKEN_MISSING` |
| Membership me without token | `GET /api/v1/membership/me` | PASS guard, HTTP 401 `AUTH_TOKEN_MISSING` |
| Referral downlines without token | `GET /api/v1/referrals/downlines` | PASS guard, HTTP 401 `AUTH_TOKEN_MISSING` |
| Referral commissions without token | `GET /api/v1/referrals/commissions` | PASS guard, HTTP 401 `AUTH_TOKEN_MISSING` |
| Membership orders without token | `GET /api/v1/membership/orders/me` | PASS guard, HTTP 401 `AUTH_TOKEN_MISSING` |

## User Feature Matrix

| Feature | Status | Evidence / Notes |
| --- | --- | --- |
| Registrasi User Basic | BLOCKED | Would mutate production by creating a real user. Needs approved UAT account/phone range before execution. |
| Login User | BLOCKED | No valid USER credential provided for production. |
| Logout User | BLOCKED | Requires successful login in APK/session. |
| Dashboard User | BLOCKED | Requires valid USER token/APK session. |
| TapGoPay | BLOCKED | Requires `GET /api/v1/wallet` with USER token. Unauthenticated guard works. |
| PPOB Balance | BLOCKED | Requires USER token. Also see membership package PPOB issue in membership report. |
| Referral Code | BLOCKED | Requires USER token/auth me or referral summary. |
| Referral Tree | BLOCKED | Requires USER token. Unauthenticated guard works. |
| Membership Menu | PARTIAL | Public package endpoint loads. Package benefit values not fully aligned. |
| Membership Upgrade | BLOCKED | Creating order/payment would mutate production. Needs UAT user. |
| Invoice Menu | BLOCKED | Requires USER token and existing orders. |
| Withdraw Menu | BLOCKED | Requires USER token; real submit would mutate production. |
| Profile Menu | BLOCKED | Requires USER token/APK session. |

## Dummy / Cache Static Audit

Static search found remaining Flutter symbols/files containing demo/fallback terminology:

- `apps/user_app/lib/data/demo_user_session.dart`
- `apps/user_app/lib/data/demo_admin_data.dart`
- `apps/user_app/lib/data/demo_referral_tree_data.dart`
- `apps/user_app/lib/services/persistent_demo_store.dart`
- `apps/user_app/lib/screens/payment_demo_screen.dart`
- Several screens still read `_demoSessionProvider`.

Important nuance:

- Production mode appears to force API root to `https://api.tapgolion.id`.
- Some admin lists only use demo fallback in development mode.
- This must still be verified on APK with a valid production user because stale local session/cache can only be proven on-device.

## User UAT Result

Overall status: BLOCKED FOR AUTHENTICATED USER FLOW.

Reason:

- No valid production USER credential was available.
- Mutating flows such as register/order/withdraw were not executed to avoid changing production data.

Required next step:

- Provide or create approved UAT USER credentials and explicit permission for production UAT data creation.
