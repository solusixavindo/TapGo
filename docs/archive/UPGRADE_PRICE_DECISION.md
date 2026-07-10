# TapGo Upgrade Price Decision

Date: 2026-06-09

## Context

Current backend behavior uses full target package price for every paid membership order.

This document compares the two possible final policies before changing production financial behavior.

## Option A: Full Package Price

Upgrade member pays full target package price.

| Flow | Amount |
| --- | ---: |
| Silver -> Gold | Rp3.000.000 |
| Gold -> Platinum | Rp5.500.000 |
| Silver -> Platinum | Rp5.500.000 |

### Dampak Sponsor Bonus

Sponsor bonus is calculated from the full package amount.

- Silver -> Gold: 8% x Rp3.000.000 = Rp240.000 for Silver/Gold/Platinum sponsor.
- Gold -> Platinum: 8% x Rp5.500.000 = Rp440.000 for Silver/Gold/Platinum sponsor.
- Basic sponsor remains fixed Rp2.000.

### Dampak Level Bonus

Level bonus is calculated from the full package amount.

This maximizes payout and keeps formula simple.

### Dampak Invoice

Invoice is simple:

- selected package price = invoice amount.
- no need to inspect current tier price.
- easier customer support explanation.

### Dampak Profit Perusahaan

Higher revenue per upgrade and larger payout base.

Risk:

- Users upgrading from Silver/Gold may feel they are paying twice for previous tier value.

## Option B: Differential Price

Upgrade member pays only the price difference between current active tier and target tier.

| Flow | Amount |
| --- | ---: |
| Silver -> Gold | Rp2.500.000 |
| Gold -> Platinum | Rp2.500.000 |
| Silver -> Platinum | Rp5.000.000 |

### Dampak Sponsor Bonus

Sponsor bonus should be calculated from the paid difference amount, unless business explicitly chooses full target package as bonus base.

Example if using paid amount:

- Silver -> Gold: 8% x Rp2.500.000 = Rp200.000.
- Gold -> Platinum: 8% x Rp2.500.000 = Rp200.000.
- Silver -> Platinum: 8% x Rp5.000.000 = Rp400.000.

### Dampak Level Bonus

Level bonus should also use paid difference amount to avoid overpaying commission relative to collected cash.

### Dampak Invoice

Invoice needs additional fields:

- current tier
- target tier
- target package price
- previous package credit
- payable upgrade amount

### Dampak Profit Perusahaan

More user-friendly and reduces double-payment perception.

Risk:

- More complex support/accounting.
- Requires clear commission base decision.
- Existing tests and reports must be adjusted.

## Rekomendasi Paling Aman

For short-term UAT:

- Keep Option A because it is already implemented, tested, and avoids undercharging.

For production commercial launch:

- PT. TapGo Lion Indonesia should formally decide whether upgrade is full price or differential price.
- If using Option B, implement as a separate controlled change with migration/test/report updates.

Recommended accounting-safe policy if Option B is chosen:

- Invoice amount = payable difference.
- Sponsor and level bonus base = actual paid amount.
- PPOB benefit should be credited only for the target tier benefit policy approved by business.

## Status

No code change was made for upgrade pricing in this review stage.
