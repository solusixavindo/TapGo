# Payment Gateway Status

## Decision

TapGo v1.0 uses DOKU as the primary payment gateway.

## Gateway Matrix

| Gateway | Role | Status | Notes |
| --- | --- | --- | --- |
| DOKU | Primary gateway | Create payment PASS, webhook UAT pending | DOKU Checkout mode only. Production endpoint returned `paymentUrl` successfully. |
| Midtrans | Secondary/fallback | Documents submitted, waiting review | Kept as fallback while Midtrans merchant review/payment channel process continues. |
| Xendit | Not used in TapGo v1.0 | Not applicable | Xendit is not part of TapGo v1.0 payment architecture or app flow. |

## DOKU Configuration

- `DOKU_ENABLED=true`
- `DOKU_INTEGRATION_MODE=checkout`
- `DOKU_ENVIRONMENT=production`
- `DOKU_BASE_URL=https://api.doku.com`
- Create payment: `POST /api/v1/payments/doku/create`
- Webhook: `POST /api/v1/webhooks/doku`
- Production webhook URL:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

## Midtrans Configuration

Midtrans is retained as secondary/fallback and must not be removed until owner approves a later payment architecture change.

## Xendit Status

Xendit is explicitly not used for TapGo v1.0:

- no user-facing payment flow,
- no webhook flow,
- no architecture dependency,
- no release checklist dependency.

If Xendit is evaluated later, it must be handled as a separate post-v1.0 design and implementation phase.
