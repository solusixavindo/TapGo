# TapGo Upgrade Financial Flow Audit

Date: 2026-06-09

## Current Behavior

Current membership order creation uses the selected package price as `membership_orders.total_amount` and `invoices.amount`.

| Flow | Current Amount Behavior | Status |
| --- | --- | --- |
| Basic -> Silver | Full Silver price Rp500.000 | Implemented |
| Basic -> Gold | Full Gold price Rp3.000.000 | Implemented |
| Basic -> Platinum | Full Platinum price Rp5.500.000 | Implemented |
| Silver -> Gold | Full Gold price Rp3.000.000 | Implemented |
| Silver -> Platinum | Full Platinum price Rp5.500.000 | Implemented |
| Gold -> Platinum | Full Platinum price Rp5.500.000 | Implemented |

No differential-price rule is implemented yet.

## Safety Guard

- Downgrade is blocked by tier rank.
- Pending/failed/cancelled orders do not trigger PPOB, sponsor bonus, level bonus, or reward evaluation.
- Bonus payout runs only through `markPaymentSuccess`, after invoice/payment status changes to `PAID`.
- Duplicate paid invoice is rejected before duplicate bonus execution.

## Open Business Question

The final business rule has not explicitly decided whether upgrade pricing should be full package price or price difference.

Examples requiring business approval:

- Silver -> Gold: full Rp3.000.000 or difference Rp2.500.000.
- Gold -> Platinum: full Rp5.500.000 or difference Rp2.500.000.
- Silver -> Platinum: full Rp5.500.000 or difference Rp5.000.000.

## Risk

If the company intends differential pricing, the current full-price flow may overcharge upgrade users. If the company intends full repurchase, current behavior is consistent.

## Recommendation

Before production financial settlement, PT. TapGo Lion Indonesia should choose one final rule:

1. Full package price for every upgrade.
2. Differential price between current active tier and target tier.

Until approved, keep current full-price behavior because it avoids negative amounts and avoids accidental undercharging.

## Tests Added

- `upgradeFinancialFlow.integration.test.ts`

Covered:

- Silver -> Gold uses full Gold price.
- Gold/Platinum downgrade attempts are rejected.
- Pending membership orders do not trigger financial payout.
