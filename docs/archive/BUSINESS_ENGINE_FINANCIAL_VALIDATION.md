# TapGo Business Engine Financial Validation

Tanggal validasi: 9 Juni 2026  
Scope: Reward Engine, Profit Sharing Engine, PPOB vs Wallet Separation, Financial Safety Audit.  
Environment: database test lokal via `TAPGO_TEST_DATABASE_URL`.  
Larangan yang dipatuhi: tidak build APK, tidak deploy VPS, tidak menyentuh production database, tidak mengubah UI/dashboard/login/endpoint production.

## 1. Executive Summary

Core engine sebelumnya sudah PASS untuk referral, sponsor bonus, level bonus, auto-upgrade, downgrade protection, idempotency membership payment, dan wallet integrity.

Tahap financial validation ini menemukan:

- Reward Engine: PARTIAL / P1 GAP.
  - Current engine hanya memberi reward Rp500.000 untuk Platinum dengan 10 direct referral.
  - Final rule meminta reward untuk member Silver berdasarkan direct Silver aktif dengan threshold 10/100/1.000/10.000/100.000.
  - Current engine juga menghitung direct referral umum, bukan direct Silver aktif.
- Profit Sharing Engine: PARTIAL / P1 GAP.
  - Current engine membagi `totalPoolAmount` rata ke semua active member.
  - Final rule meminta `60% net profit`, lalu alokasi 30% Silver qualified, 20% Gold, 10% Platinum.
- PPOB vs Wallet Separation: PARTIAL / P1 GAP.
  - Current system memakai satu wallet balance untuk PPOB benefit dan wallet cash.
  - Basic registration Rp5.000 masuk `REGISTRATION_BONUS` wallet cash, bukan PPOB.
  - PPOB benefit Silver dapat ditarik via withdrawal karena bercampur di wallet balance.
- Financial Safety: PARTIAL.
  - Idempotency dan ledger reference untuk bonus utama kuat.
  - Namun pemisahan wallet cash vs PPOB belum aman untuk production financial semantics.

Recommendation:

- Untuk APK UAT internal: boleh lanjut jika P1 gap ini dijelaskan sebagai known limitation dan fitur withdraw/financial settlement tidak dianggap final.
- Untuk Google Play production atau transaksi uang real: sebaiknya perbaiki P1 terlebih dahulu, terutama PPOB-vs-wallet separation dan profit sharing formula final.

Production Readiness Score financial engine: 68%.

## 2. Test Result

Targeted financial validation command:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public npx vitest run apps/backend/tests/business-engine/financialValidation.integration.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    3.98s
```

Full backend test command:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public npm --workspace apps/backend run test
```

Result:

```text
Test Files  10 passed (10)
Tests       80 passed (80)
Duration    17.28s
```

Skip status:

- 0 skipped pada run final.

Backend build:

```text
npm --workspace apps/backend run build
PASS
```

Prisma validate:

```text
Prisma schema loaded from apps/backend/prisma/schema.prisma
The schema at apps/backend/prisma/schema.prisma is valid
```

## 3. Reward Engine Validation

Rule final:

| Threshold Direct Silver Aktif | Reward |
|---:|---:|
| 10 | Rp500.000 |
| 100 | Rp5.000.000 |
| 1.000 | Rp50.000.000 |
| 10.000 | Rp500.000.000 |
| 100.000 | Rp5.000.000.000 |

Targeted test marker:

```text
BUSINESS_ENGINE_FINANCIAL_REWARD_MATRIX
```

Actual matrix:

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Silver with 9 direct active Silver | Tidak mendapat reward | No reward posted | MATCH |
| Silver with 10 direct active Silver | Reward Rp500.000 | No reward posted | P1 GAP |
| Silver with 100 direct active Silver | Reward Rp5.000.000 | No reward posted | P1 GAP |
| Silver with 1.000 direct active Silver | Reward Rp50.000.000 | No reward posted | P1 GAP |
| Silver with 9 active Silver + 1 Basic/Pending | Tidak mendapat reward | No reward posted | MATCH |
| Current implemented Platinum + 10 Basic direct referrals | Tidak boleh reward karena bukan direct Silver aktif | Reward Rp500.000 posted | P1 GAP |

Reward ledger observed:

| Transaction ID | Amount | Reference | Timestamp |
|---|---:|---|---|
| `2d344a9f-ca00-4ebc-b60c-64ef62d572a8` | Rp500.000 | `REWARD_MILESTONE:PLATINUM_10_DIRECT` | `2026-06-09T07:10:50.702Z` |

Idempotency proof:

- Same reward milestone was processed through another Platinum order attempt.
- Reward commission count for `PLATINUM_10_DIRECT` remained 1.
- Status: PASS for current single-threshold implementation.

Gap detail:

- `MembershipOrderService.creditRewardBonus` currently checks `membershipTier === "PLATINUM"` and `directSponsorCount >= 10`.
- It does not validate direct referrals are active Silver.
- It does not implement 100/1.000/10.000/100.000 thresholds.
- It posts reward immediately as `REWARD_BONUS` instead of a pending/approved/paid reward workflow.

Recommendation:

- Introduce `reward_milestones` or typed reward ledger.
- Count direct downlines with active `SILVER` membership only.
- Add unique constraint per `beneficiaryId + threshold`.
- Support statuses `PENDING`, `APPROVED`, `PAID`, `REJECTED`.

## 4. Profit Sharing Validation

Rule final:

- Profit sharing pool = 60% net profit monthly.
- Silver qualified allocation = 30% of pool.
- Gold allocation = 20% of pool.
- Platinum allocation = 10% of pool.
- Silver qualified means minimal 3 direct Silver aktif.
- Gold and Platinum qualified without sponsor.

Formula simulation:

| Net Profit | Pool 60% | Silver 30% Pool | Gold 20% Pool | Platinum 10% Pool | Retained / Undistributed |
|---:|---:|---:|---:|---:|---:|
| Rp10.000.000 | Rp6.000.000 | Rp1.800.000 | Rp1.200.000 | Rp600.000 | Rp2.400.000 |
| Rp100.000.000 | Rp60.000.000 | Rp18.000.000 | Rp12.000.000 | Rp6.000.000 | Rp24.000.000 |
| Rp1.000.000.000 | Rp600.000.000 | Rp180.000.000 | Rp120.000.000 | Rp60.000.000 | Rp240.000.000 |

Targeted test marker:

```text
BUSINESS_ENGINE_FINANCIAL_PROFIT_SHARING_MATRIX
```

Current implementation observed:

- Input `totalPoolAmount`: Rp6.000.000.
- Distribution mode: equal split to every active `UserMembership`.
- Actual recipients: 7 active members.
- Actual amount per recipient: Rp857.142,86.

Actual recipient examples:

| User | Amount | Status | Has Wallet Tx | Has Commission |
|---|---:|---:|---:|---:|
| PS-SILVER-NO-DIRECT | Rp857.142,86 | POSTED | Yes | Yes |
| PS-SILVER-QUALIFIED | Rp857.142,86 | POSTED | Yes | Yes |
| PS-GOLD-NO-DIRECT | Rp857.142,86 | POSTED | Yes | Yes |
| PS-PLATINUM-NO-DIRECT | Rp857.142,86 | POSTED | Yes | Yes |
| PS-SILVER-QUALIFIED-DIRECT-1 | Rp857.142,86 | POSTED | Yes | Yes |
| PS-SILVER-QUALIFIED-DIRECT-2 | Rp857.142,86 | POSTED | Yes | Yes |
| PS-SILVER-QUALIFIED-DIRECT-3 | Rp857.142,86 | POSTED | Yes | Yes |

Expected vs actual:

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Silver tanpa 3 direct Silver aktif | Tidak qualified | Received profit sharing | P1 GAP |
| Silver dengan 3 direct Silver aktif | Qualified | Received profit sharing | MATCH |
| Gold tanpa sponsor | Qualified | Received profit sharing | MATCH |
| Platinum tanpa sponsor | Qualified | Received profit sharing | MATCH |
| Same period distributed twice | Rejected | `PROFIT_SHARING_ALREADY_DISTRIBUTED` | PASS |
| Empty category allocation | Retained/undistributed by category | Not modeled by category | P1 GAP |

Gap detail:

- Current `ProfitSharingService.distribute` uses all active memberships.
- It does not separate pool allocation by tier.
- It does not evaluate Silver direct active Silver qualification.
- It does not record retained/undistributed category allocation.
- It treats `totalPoolAmount` as distributable amount, not net profit input.

Recommendation:

- Add `netProfitAmount` input.
- Derive `poolAmount = netProfitAmount * 60%`.
- Store category allocations.
- Query qualified Silver by direct active Silver count >= 3.
- Query all Gold and Platinum active.
- Store undistributed allocation if no qualified recipient exists in a category.
- Keep period idempotency with `periodId + userId`.

## 5. PPOB vs Wallet Separation Audit

Rule final:

- PPOB is only for PPOB benefits/usage.
- Wallet Cash is only for sponsor bonus, level bonus, reward bonus, profit sharing, withdrawal.
- Basic registration Rp5.000 must be PPOB, not wallet cash.
- Withdrawal must not consume PPOB benefit.

Targeted test marker:

```text
BUSINESS_ENGINE_FINANCIAL_PPOB_WALLET_MATRIX
```

Expected vs actual:

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Basic user registration | PPOB Rp5.000, Wallet Cash Rp0 | Wallet Rp5.000 via `REGISTRATION_BONUS` | P1 GAP |
| Silver upgrade | PPOB +Rp100.000, Wallet Cash unchanged | `WalletTransaction PPOB_BENEFIT Rp100.000` in same wallet balance | PARTIAL |
| Gold upgrade | PPOB +Rp600.000, Wallet Cash unchanged | `WalletTransaction PPOB_BENEFIT Rp600.000` in same wallet balance | PARTIAL |
| Platinum upgrade | PPOB +Rp1.000.000, Wallet Cash unchanged | `WalletTransaction PPOB_BENEFIT Rp1.000.000` in same wallet balance | PARTIAL |
| Sponsor bonus | Masuk Wallet Cash | `SPONSOR_BONUS Rp40.000` | MATCH |
| Level bonus | Masuk Wallet Cash | `LEVEL_BONUS Rp20.000` | MATCH |
| Withdraw after Silver PPOB benefit | Tidak bisa menarik PPOB benefit | Withdrawal PENDING Rp50.000 | P1 GAP |

Current architecture:

- `wallets.balance` is one balance.
- `wallet_transactions.type` distinguishes `PPOB_BENEFIT`, `REGISTRATION_BONUS`, bonus, withdrawal, etc.
- Withdrawal checks only `wallet.balance >= amount`.

Risk if left unchanged:

- PPOB benefit can be withdrawn as cash.
- Basic registration Rp5.000 can be treated as withdrawable wallet cash.
- Admin/reporting can overstate withdrawable wallet liabilities.
- User-facing financial semantics become legally ambiguous.

Recommendation:

Option A, safer:

- Add separated balances:
  - `wallet_cash_accounts`
  - `ppob_accounts`
  - or fields `cashBalance` and `ppobBalance`.
- Add separated ledgers:
  - `wallet_cash_ledger`
  - `ppob_ledger`.
- Withdrawal only decrements cash balance.

Option B, smaller migration:

- Keep `wallet_transactions` but add computed balance by transaction class.
- Withdrawal available balance = sum cash-credit types minus cash-debit types.
- Exclude `PPOB_BENEFIT` and Basic PPOB from withdrawable balance.

Recommended path:

- Use Option A for financial clarity before Google Play production.

## 6. Financial Safety Audit

| Area | Result | Evidence |
|---|---:|---|
| Nominal storage | PARTIAL | Prisma uses `Decimal(14,2)`, not JS float. It is safe from float drift, but not strict integer rupiah. |
| Bonus reference uniqueness | PASS | Commission unique key: `beneficiaryId + triggerType + triggerId + type + level`. |
| Sponsor bonus ledger | PASS | Sponsor bonus creates wallet transaction and commission. |
| Level bonus ledger | PASS | Level bonus creates wallet transaction and commission. |
| Reward ledger | PARTIAL | Current reward creates ledger, but rule/threshold basis is not final. |
| Profit sharing ledger | PARTIAL | Creates wallet transaction and commission, but formula/eligibility are not final. |
| Ledger without reference | PARTIAL | Main bonus flows have reference; broader historical data was not production-audited here. |
| Negative balance | PASS for tested withdrawal concurrency | Concurrent request invariant passed: one fulfilled, one rejected, no negative balance. |
| Idempotency reward | PASS for current single threshold | Duplicate milestone count remains 1. |
| Idempotency profit sharing | PASS | Second distribution rejected with `PROFIT_SHARING_ALREADY_DISTRIBUTED`. |
| Idempotency membership payment | PASS from previous proof | Second payment success rejected. |
| Idempotency sponsor/level bonus | PASS from previous proof | Unique commission prevents duplicate payout. |
| Withdrawal cash-vs-PPOB boundary | FAIL | PPOB benefit can be withdrawn because balances are mixed. |

## 7. Expected vs Actual Matrix

| Domain | Expected Final Rule | Actual Current System | Status |
|---|---|---|---|
| Reward threshold 10 Silver | Silver with 10 direct active Silver gets Rp500.000 | No reward | P1 GAP |
| Reward threshold 100 Silver | Silver with 100 direct active Silver gets Rp5.000.000 | No reward | P1 GAP |
| Reward threshold 1.000 Silver | Silver with 1.000 direct active Silver gets Rp50.000.000 | No reward | P1 GAP |
| Reward direct Basic/Pending | Not counted | Platinum with 10 Basic direct gets reward | P1 GAP |
| Reward idempotency | Same threshold not double | Current single threshold not double | PASS |
| Profit sharing pool | 60% net profit | Manual `totalPoolAmount` distributed directly | P1 GAP |
| Profit sharing Silver eligibility | Silver needs 3 direct Silver active | All active Silver receive | P1 GAP |
| Profit sharing Gold | Qualified without sponsor | Receives if active | MATCH |
| Profit sharing Platinum | Qualified without sponsor | Receives if active | MATCH |
| Profit sharing empty category | Retain/undistributed | Not modeled | P1 GAP |
| Basic registration benefit | PPOB Rp5.000 for first 1.000 | Wallet cash `REGISTRATION_BONUS` | P1 GAP |
| Silver/Gold/Platinum PPOB | PPOB benefit, not cash | `PPOB_BENEFIT` in same wallet balance | PARTIAL |
| Withdrawal | Cash only, exclude PPOB | Can withdraw mixed balance | P1 GAP |

## 8. Remaining P0/P1/P2 Gap

P0:

- None found that corrupts existing tested sponsor/level/payment idempotency flows.

P1:

- Reward final rule not aligned:
  - Must be Silver direct active Silver thresholds.
  - Must support 10/100/1.000/10.000/100.000.
  - Must not reward Basic/Pending direct referrals.
- Profit sharing final rule not aligned:
  - Must derive pool from 60% net profit.
  - Must allocate by category 30/20/10.
  - Must enforce Silver 3 direct Silver active qualification.
  - Must handle retained/undistributed category amount.
- PPOB vs Wallet separation not aligned:
  - Basic Rp5.000 currently wallet cash.
  - PPOB benefits share same wallet balance.
  - Withdrawal can consume PPOB balance.

P2:

- Monetary model uses `Decimal(14,2)` rather than integer rupiah. This is acceptable technically, but integer minor-unit accounting would reduce ambiguity.
- Reward/profit sharing statuses are too direct-posted for final operational approval workflows.

## 9. Production Readiness Score

Financial readiness score: 68%.

Breakdown:

- Sponsor/level/wallet idempotency core: strong.
- Reward final compliance: weak.
- Profit sharing final compliance: weak.
- PPOB/cash separation: weak and financially sensitive.

Recommendation:

- APK UAT internal: boleh lanjut hanya jika reward/profit sharing/PPOB separation diberi label known limitation dan tidak dipakai sebagai transaksi cash final.
- Google Play production dengan uang real: harus perbaiki P1 dulu.

## 10. Files Added/Changed

Added:

- `apps/backend/tests/business-engine/financialValidation.integration.test.ts`
- `BUSINESS_ENGINE_FINANCIAL_VALIDATION.md`

No APK build.

No VPS deploy.

No production database touched.
