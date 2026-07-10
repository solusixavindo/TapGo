# TapGo P1 Financial Engine Release Readiness

Date: 2026-06-09

## 1. Migration Readiness

Migration reviewed:

- `apps/backend/prisma/migrations/0012_financial_engine_p1_fix/migration.sql`

Readiness:

- Status: Ready for UAT backend deployment after backup.
- Production DB touched in this task: No.
- VPS deploy performed: No.

Safety summary:

- No table drop.
- No data deletion.
- Existing `wallets.balance` is retained.
- New `wallets.cash_balance` is initialized from existing `wallets.balance`.
- New `wallets.ppob_balance` defaults to `0`.
- Existing wallet transaction ledger remains readable.
- Existing withdrawal rows remain intact.

Known production consideration:

- Historical PPOB cannot be safely reconstructed automatically from old mixed wallet balance. Migration keeps old `balance` as cash to avoid removing any user balance. Historical PPOB reclassification should be a separate reconciliation task if required.

Detailed review:

- `MIGRATION_0012_PRODUCTION_REVIEW.md`

## 2. Backward Compatibility Status

Wallet API still returns the existing `balance` field.

New explicit fields:

- `balance`: cash-compatible alias, kept for older Flutter code.
- `cashBalance`: withdrawable cash balance.
- `ppobBalance`: non-withdrawable PPOB benefit balance.

Compatibility result:

| Consumer | Status |
| --- | --- |
| Old UI reading `balance` for TapGoPay | Safe, now cash only |
| UI reading `ppobBalance` | Safe |
| Wallet transactions endpoint | Safe |
| Withdrawal endpoint | Safe, cash only |
| Dashboard/admin summary | Updated to cash wallet where relevant |

No breaking endpoint path change was introduced.

## 3. Reward Admin Flow Gap

Current reward engine status:

- Reward final thresholds are implemented.
- Reward is now written to `reward_transactions`.
- New reward starts as `PENDING`.
- Reward is not automatically credited to cash wallet.

Current admin capability:

- Existing admin reports can show reward-related commission history from old posted reward commissions.
- There is no complete admin lifecycle endpoint for the new `reward_transactions` table yet.

Missing endpoints:

- `GET /api/v1/admin/rewards`
- `GET /api/v1/admin/rewards/:id`
- `POST /api/v1/admin/rewards/:id/approve`
- `POST /api/v1/admin/rewards/:id/reject`
- `POST /api/v1/admin/rewards/:id/paid`

Recommended admin menu:

- Reward Approval
- Reward History
- Reward Pending
- Reward Paid/Rejected

Recommended safety:

- `approve`: `PENDING -> APPROVED`
- `reject`: `PENDING -> REJECTED`
- `paid`: `APPROVED -> PAID`
- Cash wallet credit should happen only on `paid`.
- Unique reward reference remains `userId + referenceType + referenceId`.

Release decision:

- UAT can proceed if reward pending records are accepted as backend-ready but not admin-payable yet.
- Google Play production with real reward payout should wait for reward admin lifecycle endpoint.

## 4. Upgrade Price Decision Gap

Current behavior:

- Upgrade order amount uses full target package price.

Open business decision:

- Option A: full package price.
- Option B: differential price.

See:

- `UPGRADE_PRICE_DECISION.md`

Recommendation:

- Keep current full-price behavior for UAT.
- Do not alter payout base until PT. TapGo Lion Indonesia approves final policy.

## 5. Test Result

Backend test:

- Command: `npm --workspace apps/backend run test`
- Result: PASS
- Files: 14 passed
- Tests: 92 passed
- Skipped: 0

Backend build:

- Command: `npm --workspace apps/backend run build`
- Result: PASS

Prisma validate:

- Command: `npx prisma validate --schema apps/backend/prisma/schema.prisma`
- Result: PASS

Prisma generate:

- Command: `npx prisma generate --schema apps/backend/prisma/schema.prisma`
- Result: PASS

Flutter validation:

- Command: `flutter analyze`
- Result: PASS, no issues found.
- Note: Flutter printed Swift Package Manager adoption warnings for several plugins. These are upstream plugin compatibility warnings and not analyzer failures.

Flutter test:

- Command: `flutter test`
- Result: PASS
- Tests: 7 passed

APK build:

- Not run, by instruction.

## 6. Aman Lanjut Deploy Backend VPS?

Conditional yes for UAT backend deployment, after:

1. Production/UAT database backup is completed.
2. Migration 0012 is reviewed by operator.
3. Release window is prepared.
4. Rollback plan is accepted.
5. Post-migration smoke test is ready.

Do not deploy directly from this review task.

## 7. Aman Lanjut Build APK UAT?

Yes for APK preparation after backend migration decision is approved.

APK build should wait until:

- backend migration plan is accepted,
- target backend environment is migrated,
- wallet endpoint smoke test confirms `balance`, `cashBalance`, and `ppobBalance`.
- this task explicitly did not build an APK.

## 8. Recommended Smoke Test After Backend Migration

```bash
curl -fsS https://api.tapgolion.id/health
```

Login and wallet check:

```bash
curl -s https://api.tapgolion.id/api/v1/wallet \
  -H "Authorization: Bearer <TOKEN>"
```

Expected wallet shape:

```json
{
  "success": true,
  "data": {
    "balance": "cash alias",
    "cashBalance": "withdrawable cash",
    "ppobBalance": "non-withdrawable ppob"
  }
}
```

## 9. Final Readiness

Current status:

- Backend financial engine: Ready for UAT migration planning.
- Migration: Ready with backup requirement.
- Reward admin lifecycle: Gap remains.
- Upgrade price policy: Business decision remains.
- Backend test/build/Prisma validation: PASS.
- Flutter analyze/test: PASS.
- APK: Not built in this stage by instruction.
