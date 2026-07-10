# TapGo Wallet System

## Scope

This module provides production-grade wallet foundations for:

- wallet balance lookup
- wallet transaction history
- withdrawal request
- admin approval, rejection, and paid marking
- commission integration through `wallet_transactions`

## Safety Model

Withdrawals reserve balance immediately when the user requests a withdrawal. The reservation happens in a Prisma transaction with `Serializable` isolation:

1. Get or create wallet.
2. Atomically decrement wallet only when `balance >= amount`.
3. Create `withdrawals` row with `PENDING` status.
4. Create `wallet_transactions` row with negative `WITHDRAWAL` amount.

If any step fails, the full transaction rolls back.

## Admin Flow

- `APPROVED`: marks a pending withdrawal as reviewed. Balance was already reserved.
- `REJECTED`: marks withdrawal rejected and refunds the reserved amount to wallet.
- `PAID`: marks approved withdrawal as paid and logs a zero-amount wallet transaction for audit trace.

All admin actions write `audit_logs` rows.

## API

All routes require JWT authentication.

- `GET /api/v1/wallet`
- `GET /api/v1/wallet/transactions?page=1&pageSize=20`
- `GET /api/v1/wallet/withdrawals?page=1&pageSize=20`
- `POST /api/v1/wallet/withdrawals`
- `GET /api/v1/wallet/admin/users/:userId`
- `GET /api/v1/wallet/admin/withdrawals?status=PENDING&page=1&pageSize=20`
- `POST /api/v1/wallet/admin/withdrawals/:withdrawalId/approve`
- `POST /api/v1/wallet/admin/withdrawals/:withdrawalId/reject`
- `POST /api/v1/wallet/admin/withdrawals/:withdrawalId/paid`

Admin routes require `ADMIN` or `SUPER_ADMIN`.
