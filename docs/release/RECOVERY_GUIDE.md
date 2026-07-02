# TapGo Recovery Guide

## Scope

This guide defines recovery steps for TapGo production incidents during DOKU checkout rollout. It does not execute deployment, rollback, or database changes.

## Recovery Priorities

1. Protect production data.
2. Keep paid invoices and membership status consistent.
3. Avoid duplicate wallet, referral, or bonus ledger processing.
4. Restore API availability.
5. Preserve forensic logs for audit.

## Immediate Checks

```bash
pm2 status
pm2 logs tapgo-api --lines 200
curl -fsS https://api.tapgolion.id/health
```

Check:

- API health.
- Database connectivity.
- Redis connectivity.
- Recent payment webhook logs.
- Recent membership order updates.

## Payment Incident Recovery

### DOKU Create Payment Fails

Action:

- Keep invoice status as `PENDING`.
- Do not activate membership.
- Ask user to retry payment creation later.
- Admin may retry create payment after gateway health is confirmed.

### Webhook Signature Fails

Action:

- Do not update invoice.
- Do not activate membership.
- Verify DOKU dashboard webhook URL.
- Verify production env values on backend.
- Compare DOKU timestamp/header requirements with backend logs.

### Duplicate Paid Webhook

Expected behavior:

- Return success response.
- Do not process bonus again.
- Do not create duplicate ledger entries.

### Failed/Expired After Paid

Expected behavior:

- Keep invoice `PAID`.
- Keep membership active.
- Do not reverse wallet/bonus automatically.
- Escalate to finance/admin if DOKU reports a real refund or chargeback.

## Rollback Steps

Use only after a production backup exists.

```bash
cd /var/www/Tapgo
pm2 stop tapgo-api
# restore previous source backup here
npm ci
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
curl -fsS https://api.tapgolion.id/health
```

If database rollback is required, restore from the latest verified PostgreSQL dump. Do not partially edit payment or wallet rows manually without an approved reconciliation plan.

## Manual Reconciliation Checklist

| Data | Check |
|---|---|
| Invoice | status, amount, gateway reference, paid timestamp |
| Membership order | status, package, processed timestamp |
| Payment record | provider, reference, transaction ID, raw response |
| Wallet ledger | no duplicate sponsor/level/PPOB benefit |
| Referral bonus | no duplicate payout |
| Admin report | payment status matches ledger |

## Communication

Use clear status wording:

- Payment pending: payment has not been confirmed by gateway.
- Payment received: payment was confirmed and membership is being activated.
- Payment issue: payment requires admin verification.

Avoid promising instant activation when a gateway/webhook incident is ongoing.
