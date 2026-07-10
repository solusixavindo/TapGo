CREATE TYPE "MembershipTier" AS ENUM ('SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE "ReferralStatus" AS ENUM ('ACTIVE', 'BLOCKED');
CREATE TYPE "CommissionType" AS ENUM ('DIRECT_REFERRAL', 'LEVEL_COMMISSION', 'MEMBERSHIP_UPGRADE', 'ADMIN_ADJUSTMENT');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

CREATE TABLE "memberships" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "tier" "MembershipTier" NOT NULL UNIQUE,
  "name" VARCHAR(80) NOT NULL,
  "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "direct_bonus" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "active_levels" INTEGER NOT NULL DEFAULT 1 CHECK ("active_levels" BETWEEN 1 AND 10),
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "membership_benefits" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "membership_id" UUID NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 10),
  "commission_rate" DECIMAL(5,2) NOT NULL,
  "fixed_bonus" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_benefits_membership_id_level_key" UNIQUE ("membership_id", "level")
);

ALTER TABLE "users"
  ADD COLUMN "membership_id" UUID REFERENCES "memberships"("id");

CREATE TABLE "referrals" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "sponsor_id" UUID NOT NULL REFERENCES "users"("id"),
  "user_id" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "ReferralStatus" NOT NULL DEFAULT 'ACTIVE',
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blocked_at" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "referrals_no_self_referral" CHECK ("sponsor_id" <> "user_id")
);

CREATE TABLE "referral_levels" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "ancestor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "descendant_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "level" INTEGER NOT NULL CHECK ("level" BETWEEN 1 AND 10),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_levels_ancestor_id_descendant_id_key" UNIQUE ("ancestor_id", "descendant_id"),
  CONSTRAINT "referral_levels_no_self_link" CHECK ("ancestor_id" <> "descendant_id")
);

CREATE TABLE "commissions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "beneficiary_id" UUID NOT NULL REFERENCES "users"("id"),
  "source_user_id" UUID NOT NULL REFERENCES "users"("id"),
  "referral_id" UUID REFERENCES "referrals"("id"),
  "wallet_transaction_id" UUID UNIQUE REFERENCES "wallet_transactions"("id"),
  "type" "CommissionType" NOT NULL,
  "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
  "level" INTEGER CHECK ("level" IS NULL OR "level" BETWEEN 1 AND 10),
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" >= 0),
  "rate" DECIMAL(5,2),
  "trigger_type" VARCHAR(80) NOT NULL,
  "trigger_id" VARCHAR(120) NOT NULL,
  "metadata" JSONB,
  "posted_at" TIMESTAMP(3),
  "reversed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commissions_beneficiary_trigger_type_trigger_id_type_level_key"
    UNIQUE ("beneficiary_id", "trigger_type", "trigger_id", "type", "level")
);

CREATE TABLE "withdrawals" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "wallet_id" UUID NOT NULL REFERENCES "wallets"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id"),
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "bank_account" JSONB NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "note" TEXT
);

CREATE INDEX "memberships_tier_is_active_idx" ON "memberships"("tier", "is_active");
CREATE INDEX "membership_benefits_level_is_active_idx" ON "membership_benefits"("level", "is_active");
CREATE INDEX "users_membership_id_idx" ON "users"("membership_id");
CREATE INDEX "referrals_sponsor_id_joined_at_idx" ON "referrals"("sponsor_id", "joined_at");
CREATE INDEX "referrals_status_idx" ON "referrals"("status");
CREATE INDEX "referral_levels_ancestor_id_level_idx" ON "referral_levels"("ancestor_id", "level");
CREATE INDEX "referral_levels_descendant_id_level_idx" ON "referral_levels"("descendant_id", "level");
CREATE INDEX "commissions_beneficiary_id_created_at_idx" ON "commissions"("beneficiary_id", "created_at");
CREATE INDEX "commissions_source_user_id_created_at_idx" ON "commissions"("source_user_id", "created_at");
CREATE INDEX "commissions_status_type_idx" ON "commissions"("status", "type");
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");
CREATE INDEX "withdrawals_user_id_status_idx" ON "withdrawals"("user_id", "status");
CREATE INDEX "withdrawals_wallet_id_requested_at_idx" ON "withdrawals"("wallet_id", "requested_at");

INSERT INTO "memberships" ("tier", "name", "price", "direct_bonus", "active_levels")
VALUES
  ('SILVER', 'Silver', 0, 10000, 3),
  ('GOLD', 'Gold', 150000, 25000, 6),
  ('PLATINUM', 'Platinum', 500000, 50000, 10);

INSERT INTO "membership_benefits" ("membership_id", "level", "commission_rate", "fixed_bonus")
SELECT "id", level, rate, bonus
FROM "memberships"
JOIN (
  VALUES
    ('SILVER'::"MembershipTier", 1, 5.00, 5000), ('SILVER'::"MembershipTier", 2, 2.50, 2500), ('SILVER'::"MembershipTier", 3, 1.00, 1000),
    ('GOLD'::"MembershipTier", 1, 7.50, 10000), ('GOLD'::"MembershipTier", 2, 5.00, 7500), ('GOLD'::"MembershipTier", 3, 2.50, 5000),
    ('GOLD'::"MembershipTier", 4, 2.00, 3500), ('GOLD'::"MembershipTier", 5, 1.50, 2500), ('GOLD'::"MembershipTier", 6, 1.00, 1500),
    ('PLATINUM'::"MembershipTier", 1, 10.00, 20000), ('PLATINUM'::"MembershipTier", 2, 7.50, 15000), ('PLATINUM'::"MembershipTier", 3, 5.00, 10000),
    ('PLATINUM'::"MembershipTier", 4, 4.00, 8000), ('PLATINUM'::"MembershipTier", 5, 3.00, 6000), ('PLATINUM'::"MembershipTier", 6, 2.50, 5000),
    ('PLATINUM'::"MembershipTier", 7, 2.00, 4000), ('PLATINUM'::"MembershipTier", 8, 1.50, 3000), ('PLATINUM'::"MembershipTier", 9, 1.00, 2000),
    ('PLATINUM'::"MembershipTier", 10, 0.50, 1000)
) AS benefits(tier, level, rate, bonus)
ON "memberships"."tier" = benefits.tier;

UPDATE "users"
SET "membership_id" = (SELECT "id" FROM "memberships" WHERE "tier" = 'SILVER')
WHERE "membership_id" IS NULL;
