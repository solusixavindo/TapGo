# TapGo Bug Discovery Report - UAT Phase A

Date: 2026-06-11  
Target API: `https://api.tapgolion.id`

## Summary

This report lists bugs/risks found during read-only production UAT Phase A.

No code was changed, no migration was created, no VPS deploy was performed, and no APK was built.

## P0 Critical

No confirmed P0 was proven with live authenticated production data because valid USER/ADMIN/SUPER_ADMIN credentials were not available.

Potential P0 pending confirmation:

| ID | Area | Issue | Evidence | Risk |
| --- | --- | --- | --- | --- |
| P0-CANDIDATE-001 | Membership/PPOB | Production package endpoint returns `ppobBalance=0` for Silver/Gold/Platinum | `GET /api/v1/membership/packages` | If activation uses this DB value, paid upgraded users receive no PPOB benefit. |

## P1 Major

| ID | Area | Issue | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| P1-001 | Role UAT | Default ADMIN/SUPER_ADMIN credentials no longer work | Login for `080000000001` and `080000000002` with historical password returned `INVALID_CREDENTIALS` | Provide current UAT credentials or reset approved UAT admin accounts. |
| P1-002 | Membership Package | Silver/Gold/Platinum benefit metadata missing/null | Public package endpoint shows `bpjsBenefit=null`, `merchandise=null`, `businessRight=null` | Align production package seed/data with final package benefits. |
| P1-003 | Membership/PPOB | Silver/Gold/Platinum `ppobBalance=0` | Public package endpoint | Verify activation service and production DB package values before paid UAT. |
| P1-004 | Authenticated Production Validation | User/Admin/Super Admin endpoint validation blocked | No valid tokens | Cannot approve Midtrans/Google Play readiness until live authenticated smoke test passes. |

## P2 Minor

| ID | Area | Issue | Evidence | Recommendation |
| --- | --- | --- | --- | --- |
| P2-001 | Flutter Source Hygiene | Demo/fallback symbols still exist in source | Static search found demo files/providers and development fallback references | Verify production build never displays demo data; consider cleanup after UAT freeze. |
| P2-002 | Documentation | Midtrans screenshot document still lacks real screenshots | `midtrans-transaction-flow/screenshots/` empty | Capture HP screenshots before final Midtrans submission. |

## Endpoint Health / Guard Checks

| Check | Status |
| --- | --- |
| `GET /health` | PASS |
| `GET /api/v1/health` | PASS |
| Unauthenticated wallet guard | PASS, 401 |
| Unauthenticated admin guard | PASS, 401 |
| Public package endpoint | PASS, 200 but business data issue found |

## Not Tested

The following were not executed to avoid production mutation without approved UAT credentials:

- Register new production user.
- Create membership order.
- Trigger Midtrans payment.
- Submit withdrawal.
- Approve/reject admin actions.

## Required Before Next Gate

1. Provide approved USER, ADMIN, and SUPER_ADMIN UAT credentials.
2. Confirm whether production package `ppobBalance` values should be fixed before paid UAT.
3. Run authenticated smoke test:
   - wallet cash/PPOB,
   - admin reports,
   - reward lifecycle,
   - user admin guard.
