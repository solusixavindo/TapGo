ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_balance_non_negative" CHECK ("balance" >= 0);

ALTER TABLE "wallet_transactions"
  ADD CONSTRAINT "wallet_transactions_reference_pair"
  CHECK (
    ("reference_type" IS NULL AND "reference_id" IS NULL)
    OR ("reference_type" IS NOT NULL AND "reference_id" IS NOT NULL)
  );

CREATE INDEX "referrals_user_id_status_idx" ON "referrals"("user_id", "status");
CREATE INDEX "commissions_trigger_type_trigger_id_idx" ON "commissions"("trigger_type", "trigger_id");
CREATE INDEX "withdrawals_status_requested_at_idx" ON "withdrawals"("status", "requested_at");
