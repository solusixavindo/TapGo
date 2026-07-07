-- Founder Platinum Program: admin-granted Platinum recognition without revenue,
-- invoice, payment, or automatic PPOB liability.

CREATE TYPE "FounderRole" AS ENUM ('FOUNDER_PLATINUM');

ALTER TABLE "user_memberships"
  ADD COLUMN "founder_role" "FounderRole";

CREATE TABLE "founder_program_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "user_membership_id" UUID NOT NULL,
  "founder_role" "FounderRole" NOT NULL,
  "granted_by" UUID,
  "reason" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoked_by" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "founder_program_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "founder_program_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "founder_program_grants_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "founder_program_grants_user_membership_id_fkey" FOREIGN KEY ("user_membership_id") REFERENCES "user_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "founder_program_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "founder_program_grants_user_membership_id_key" ON "founder_program_grants"("user_membership_id");
CREATE INDEX "founder_program_grants_founder_role_revoked_at_idx" ON "founder_program_grants"("founder_role", "revoked_at");
CREATE INDEX "founder_program_grants_user_id_founder_role_idx" ON "founder_program_grants"("user_id", "founder_role");
CREATE INDEX "founder_program_grants_granted_by_created_at_idx" ON "founder_program_grants"("granted_by", "created_at");
CREATE INDEX "user_memberships_founder_role_status_idx" ON "user_memberships"("founder_role", "status");
