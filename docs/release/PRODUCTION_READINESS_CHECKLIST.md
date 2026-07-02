# TapGo Production Readiness Checklist

## Payment Gateway Decision

| Gateway | Decision |
|---|---|
| DOKU | Primary gateway for TapGo v1.0 |
| Midtrans | Secondary/fallback while review continues |
| Xendit | Not used in TapGo v1.0 |

## DOKU Readiness

| Item | Status |
|---|---|
| Integration mode locked to `checkout` | Required |
| Create payment endpoint tested | PASS |
| Production `paymentUrl` generated | PASS |
| Webhook endpoint implemented | Ready for UAT |
| Webhook signature validation | Implemented and tested |
| Unknown status does not activate membership | Tested |
| Duplicate paid webhook idempotent | Tested |
| Failed after paid does not downgrade | Tested |
| Real production webhook UAT | Pending |

## Backend Readiness

| Item | Status |
|---|---|
| Backend build | Pending latest validation |
| Backend test suite | Pending latest validation |
| Prisma schema validate | Pending latest validation |
| No production migration executed from workspace | Required |
| No credentials committed | Required |
| Logs redact credential-like fields | Required |

## Mobile Readiness

| Item | Status |
|---|---|
| Flutter analyze | Pending latest validation |
| Flutter test | Pending latest validation |
| No APK/AAB built in this phase | Required |
| Production API points to `https://api.tapgolion.id` | Required before release |
| No gateway secret in Flutter app | Required |

## Business Engine Readiness

| Item | Status |
|---|---|
| Membership activates only after paid webhook | Required |
| Bonus/referral processing idempotent | Required |
| PPOB and cash wallet remain separated | Required |
| Failed/expired payment does not activate membership | Required |
| Failed/expired after paid does not downgrade paid status | Required |

## Go/No-Go

Production public launch remains conditional on:

1. DOKU production webhook UAT pass.
2. Backend deployment with backup and rollback readiness.
3. Google Play production review readiness.
4. Owner approval for final public launch.
