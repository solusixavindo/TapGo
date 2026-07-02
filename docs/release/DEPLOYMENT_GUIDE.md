# TapGo Deployment Guide

## Scope

This guide prepares a manual backend deployment for TapGo production without deploying automatically from this workspace.

## Release Position

- Primary payment gateway: DOKU Checkout.
- Secondary/fallback gateway: Midtrans.
- Xendit: not used in TapGo v1.0.
- Production API: `https://api.tapgolion.id`.

## Pre-Deployment Checklist

| Item | Status |
|---|---|
| Confirm latest backend source is reviewed | Required |
| Confirm `.env` has DOKU production credentials | Required |
| Confirm no credentials are committed | Required |
| Confirm database backup is completed | Required |
| Confirm source backup is completed | Required |
| Confirm PM2 current status is recorded | Required |
| Confirm migration plan is reviewed | Required |
| Confirm rollback steps are ready | Required |

## Required Environment

Set these values on the production backend host only:

```bash
DOKU_ENABLED=true
DOKU_INTEGRATION_MODE=checkout
DOKU_ENVIRONMENT=production
DOKU_BASE_URL=https://api.doku.com
DOKU_CLIENT_ID=
DOKU_SECRET_KEY=
DOKU_API_KEY=
DOKU_PUBLIC_KEY=
DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku
```

Do not place DOKU credentials in Flutter, public web assets, Git, screenshots, logs, or documentation.

## Manual Deployment Steps

Run on the VPS after backup is complete:

```bash
cd /var/www/Tapgo
npm ci
npx prisma generate --schema apps/backend/prisma/schema.prisma
npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
```

## Production Smoke Test

```bash
curl -fsS https://api.tapgolion.id/health
```

Then validate:

- Login works for a test user.
- Membership order creation works.
- DOKU create payment returns a `paymentUrl` or `redirectUrl`.
- Webhook URL is reachable by DOKU.
- Paid webhook activates membership once.
- Duplicate paid webhook does not duplicate bonus.
- Failed/expired webhook after paid does not downgrade invoice or membership.

## DOKU Dashboard Configuration

Set webhook or notification URL:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

Use DOKU Checkout mode for TapGo v1.0. Do not enable SNAP Direct for this release.

## Rollback Trigger

Rollback if any of the following occurs:

- Backend fails to start.
- Health endpoint fails after restart.
- Payment create endpoint returns persistent 5xx.
- Webhook rejects valid DOKU production notifications.
- Paid invoice processing duplicates wallet, referral, or bonus ledger entries.

See `docs/release/RECOVERY_GUIDE.md` for recovery steps.
