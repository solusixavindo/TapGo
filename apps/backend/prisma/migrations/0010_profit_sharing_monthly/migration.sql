ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'PROFIT_SHARING';
ALTER TYPE "CommissionType" ADD VALUE IF NOT EXISTS 'PROFIT_SHARING';

DO $$ BEGIN
  CREATE TYPE "ProfitSharingPeriodStatus" AS ENUM ('DRAFT', 'APPROVED', 'DISTRIBUTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProfitSharingDistributionStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "profit_sharing_periods" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "total_pool_amount" DECIMAL(14,2) NOT NULL,
  "status" "ProfitSharingPeriodStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "distributed_at" TIMESTAMP(3),
  CONSTRAINT "profit_sharing_periods_period_month_period_year_key" UNIQUE ("period_month", "period_year")
);

CREATE TABLE IF NOT EXISTS "profit_sharing_distributions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "period_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" "ProfitSharingDistributionStatus" NOT NULL DEFAULT 'PENDING',
  "wallet_transaction_id" UUID UNIQUE,
  "commission_id" UUID UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMP(3),
  CONSTRAINT "profit_sharing_distributions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "profit_sharing_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_sharing_distributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "profit_sharing_distributions_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "profit_sharing_distributions_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "profit_sharing_distributions_period_id_user_id_key" UNIQUE ("period_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "profit_sharing_periods_status_period_year_period_month_idx" ON "profit_sharing_periods"("status", "period_year", "period_month");
CREATE INDEX IF NOT EXISTS "profit_sharing_distributions_user_id_status_idx" ON "profit_sharing_distributions"("user_id", "status");
CREATE INDEX IF NOT EXISTS "profit_sharing_distributions_period_id_status_idx" ON "profit_sharing_distributions"("period_id", "status");
