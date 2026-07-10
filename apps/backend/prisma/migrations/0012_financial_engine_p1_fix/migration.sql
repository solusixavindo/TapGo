-- P1 financial hardening: separate withdrawable cash from PPOB benefit balance,
-- add final reward ledger states, and persist profit sharing formula components.

CREATE TYPE "RewardTransactionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

ALTER TABLE "wallets"
  ADD COLUMN "cash_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ppob_balance" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Preserve backward-compatible cash semantics for existing rows.
UPDATE "wallets"
SET "cash_balance" = "balance"
WHERE "cash_balance" = 0 AND "balance" <> 0;

ALTER TABLE "profit_sharing_periods"
  ADD COLUMN "net_profit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "silver_allocation" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gold_allocation" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "platinum_allocation" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "retained_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Existing historical periods stored a pool amount directly. Mirror it into
-- net_profit_amount only as a historical compatibility placeholder.
UPDATE "profit_sharing_periods"
SET "net_profit_amount" = "total_pool_amount"
WHERE "net_profit_amount" = 0 AND "total_pool_amount" <> 0;

CREATE TABLE "reward_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "wallet_id" UUID,
  "wallet_transaction_id" UUID,
  "threshold" INTEGER NOT NULL,
  "direct_silver_count" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" "RewardTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "reference_type" VARCHAR(80) NOT NULL DEFAULT 'REWARD_MILESTONE',
  "reference_id" VARCHAR(120) NOT NULL,
  "metadata" JSONB,
  "approved_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reward_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reward_transactions_wallet_transaction_id_key" ON "reward_transactions"("wallet_transaction_id");
CREATE UNIQUE INDEX "reward_transactions_user_id_reference_type_reference_id_key" ON "reward_transactions"("user_id", "reference_type", "reference_id");
CREATE INDEX "reward_transactions_user_id_status_idx" ON "reward_transactions"("user_id", "status");
CREATE INDEX "reward_transactions_status_created_at_idx" ON "reward_transactions"("status", "created_at");

ALTER TABLE "reward_transactions"
  ADD CONSTRAINT "reward_transactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reward_transactions"
  ADD CONSTRAINT "reward_transactions_wallet_id_fkey"
  FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reward_transactions"
  ADD CONSTRAINT "reward_transactions_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
