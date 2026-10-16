-- Insentif harian driver: aturan (diatur Super Admin) dan klaim (satu per aturan, driver, dan hari WIB).
-- AlterEnum
ALTER TYPE "WalletTransactionType" ADD VALUE 'INCENTIVE_BONUS';

-- CreateTable
CREATE TABLE "driver_incentive_rules" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "target_trips" INTEGER NOT NULL,
    "bonus_amount" DECIMAL(14,2) NOT NULL,
    "min_trip_fare" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "daily_budget" DECIMAL(14,2),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_incentive_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_incentive_claims" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day_key" VARCHAR(10) NOT NULL,
    "trip_count" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_incentive_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_incentive_claims_rule_id_driver_profile_id_day_key_key" ON "driver_incentive_claims"("rule_id", "driver_profile_id", "day_key");

-- CreateIndex
CREATE INDEX "driver_incentive_claims_day_key_idx" ON "driver_incentive_claims"("day_key");

-- CreateIndex
CREATE INDEX "driver_incentive_claims_user_id_created_at_idx" ON "driver_incentive_claims"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "driver_incentive_claims" ADD CONSTRAINT "driver_incentive_claims_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "driver_incentive_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nilai yang masuk akal dijaga juga di database.
ALTER TABLE "driver_incentive_rules" ADD CONSTRAINT "driver_incentive_rules_target_range" CHECK ("target_trips" BETWEEN 1 AND 100);
ALTER TABLE "driver_incentive_rules" ADD CONSTRAINT "driver_incentive_rules_bonus_positive" CHECK ("bonus_amount" > 0);
