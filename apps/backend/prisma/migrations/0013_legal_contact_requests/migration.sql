DO $$ BEGIN
  CREATE TYPE "AccountDeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContactMessageStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "status" "AccountDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "contact_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "name" VARCHAR(120) NOT NULL,
  "contact" VARCHAR(180) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "message" TEXT NOT NULL,
  "status" "ContactMessageStatus" NOT NULL DEFAULT 'NEW',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "account_deletion_requests"
    ADD CONSTRAINT "account_deletion_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "contact_messages"
    ADD CONSTRAINT "contact_messages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "account_deletion_requests_user_id_status_idx"
  ON "account_deletion_requests"("user_id", "status");

CREATE INDEX IF NOT EXISTS "account_deletion_requests_status_created_at_idx"
  ON "account_deletion_requests"("status", "created_at");

CREATE INDEX IF NOT EXISTS "contact_messages_user_id_created_at_idx"
  ON "contact_messages"("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "contact_messages_status_created_at_idx"
  ON "contact_messages"("status", "created_at");
