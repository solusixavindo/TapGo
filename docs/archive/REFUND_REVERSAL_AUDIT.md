# TapGo Refund / Reversal Audit

Date: 2026-06-09

## Scope

This audit covers financial reversal risk after a membership invoice is already `PAID` and financial ledger entries may have been posted.

## Current Guard

- Admin member request rejection is only allowed while membership order is `PENDING`.
- A `PAID` membership order cannot be rejected by the current admin rejection flow.
- Duplicate payment success is blocked by invoice status update guard.
- Withdrawal reject refunds a reserved withdrawal once.
- Duplicate withdrawal reject is blocked by withdrawal status guard.

## Current Limitation

There is no full refund/reversal engine yet for cases such as:

- Payment gateway refund after `PAID`.
- Manual cancellation after membership activation.
- Reversal of already-posted sponsor bonus.
- Reversal of already-posted level bonus.
- Reversal of PPOB benefit.
- Reversal of approved/paid reward.
- Reversal of profit sharing distribution.

## Recommended Reversal Ledger Types

Future reversal implementation should never delete financial rows. It should append compensating ledger rows:

- `BONUS_REVERSAL`
- `PPOB_REVERSAL`
- `REWARD_REVERSAL`
- `PROFIT_SHARING_REVERSAL`
- `MEMBERSHIP_PAYMENT_REVERSAL`
- `WITHDRAWAL_REVERSAL`

Each reversal row should include:

- original reference type/id
- original wallet transaction id
- actor/admin id
- reason
- timestamp
- signed amount

## Safety Requirement

No reversal should mutate historical commission/wallet rows silently. All reversal must be append-only and idempotent.

## Tests Added

- `refundReversalAudit.integration.test.ts`

Covered:

- Paid membership order cannot be rejected without explicit reversal flow.
- Withdrawal reject refund is posted once.
- Duplicate withdrawal reject is blocked.
