# TapGo Referral & Membership Commission Engine

## Scope

This phase adds the backend foundation for a unilevel referral system with up to 10 levels.

## Database Model

- `memberships`: Silver, Gold, Platinum configuration.
- `membership_benefits`: per-level percentage and fixed bonus rules.
- `referrals`: direct sponsor/upline relationship.
- `referral_levels`: closure table for fast 10-level downline queries.
- `commissions`: immutable commission ledger with duplicate prevention.
- `wallets`: user wallet balance.
- `wallet_transactions`: wallet movement ledger.
- `withdrawals`: user wallet withdrawal requests.

## Commission Flow

1. User claims sponsor code.
2. Backend blocks self referral and existing referral claims.
3. Backend checks closure table to prevent circular referral.
4. Backend creates direct referral row.
5. Backend creates closure rows for level 1 through max 10 ancestors.
6. `CommissionEngine` calculates direct referral bonus from sponsor membership.
7. `CommissionEngine` calculates level commission for eligible ancestors based on each ancestor's membership tier.
8. Backend posts every commission to wallet in order.
9. Wallet credit, wallet transaction, commission row, and audit log happen in one serializable database transaction.

## Duplicate Prevention

`commissions` has a unique key:

```text
beneficiary_id + trigger_type + trigger_id + type + level
```

If the same event is retried, PostgreSQL rejects the duplicate and Prisma rolls the whole transaction back, including wallet movements.

## Rollback Safety

Commission creation and wallet balance increments are performed inside a Prisma transaction with `Serializable` isolation. If any commission row fails, the wallet transaction and balance update are rolled back.

## Transaction Logging

Each successful distribution writes:

- one `wallet_transactions` row per beneficiary
- one `commissions` row per beneficiary
- one `audit_logs` row summarizing the distribution batch

The audit log stores trigger metadata and all beneficiary amounts without becoming the source of truth for wallet balances.

## API Foundation

- `POST /api/v1/referrals/claim`
- `GET /api/v1/referrals/summary`
- `GET /api/v1/referrals/tree?maxLevel=10`
- `GET /api/v1/referrals/uplink?maxLevel=10`
- `GET /api/v1/referrals/downlines?maxLevel=10&page=1&pageSize=20`
- `GET /api/v1/referrals/depth?maxLevel=10`
- `GET /api/v1/referrals/commissions?page=1&pageSize=20`

All routes require JWT authentication.

## Recursive Referral Queries

The backend keeps a `referral_levels` closure table for fast commission traversal, but read APIs for upline/downline tracking also use PostgreSQL recursive CTEs over `referrals`.

This gives two advantages:

- The API can rebuild the live tree from direct sponsor edges.
- The database can calculate depth and pagination without loading the full graph into Node.js memory.

The recursive queries are capped at 10 levels and use indexed columns:

- `referrals.user_id` for walking uplines.
- `referrals.sponsor_id` for walking downlines.
- `referrals.status` to exclude blocked links.
