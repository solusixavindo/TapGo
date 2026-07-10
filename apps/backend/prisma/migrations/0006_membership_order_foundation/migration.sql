ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

DO $$ BEGIN
  CREATE TYPE "MembershipOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "UserMembershipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MembershipDocumentType" AS ENUM ('KTP', 'SELFIE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MembershipDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "ppob_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bpjs_benefit" TEXT,
  ADD COLUMN IF NOT EXISTS "merchandise" JSONB,
  ADD COLUMN IF NOT EXISTS "business_right" TEXT;

CREATE TABLE IF NOT EXISTS "membership_orders" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "status" "MembershipOrderStatus" NOT NULL DEFAULT 'PENDING',
  "total_amount" DECIMAL(14,2) NOT NULL,
  "package_snapshot" JSONB NOT NULL,
  "registration_data" JSONB,
  "expires_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_orders_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "order_id" UUID NOT NULL UNIQUE,
  "user_id" UUID NOT NULL,
  "number" VARCHAR(40) NOT NULL UNIQUE,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'IDR',
  "due_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "membership_payments" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "order_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(14,2) NOT NULL,
  "method" VARCHAR(60) NOT NULL DEFAULT 'DEVELOPMENT_SIMULATOR',
  "provider" VARCHAR(60),
  "provider_reference" VARCHAR(120),
  "paid_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "membership_documents" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "order_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "type" "MembershipDocumentType" NOT NULL,
  "status" "MembershipDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "url" TEXT,
  "local_path" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_documents_order_id_type_key" UNIQUE ("order_id", "type")
);

CREATE TABLE IF NOT EXISTS "user_memberships" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "order_id" UUID UNIQUE,
  "status" "UserMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_memberships_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_memberships_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "membership_orders_user_id_status_idx" ON "membership_orders"("user_id", "status");
CREATE INDEX IF NOT EXISTS "membership_orders_membership_id_status_idx" ON "membership_orders"("membership_id", "status");
CREATE INDEX IF NOT EXISTS "invoices_user_id_status_idx" ON "invoices"("user_id", "status");
CREATE INDEX IF NOT EXISTS "invoices_status_created_at_idx" ON "invoices"("status", "created_at");
CREATE INDEX IF NOT EXISTS "membership_payments_user_id_status_idx" ON "membership_payments"("user_id", "status");
CREATE INDEX IF NOT EXISTS "membership_payments_order_id_status_idx" ON "membership_payments"("order_id", "status");
CREATE INDEX IF NOT EXISTS "membership_payments_provider_reference_idx" ON "membership_payments"("provider_reference");
CREATE INDEX IF NOT EXISTS "membership_documents_user_id_type_idx" ON "membership_documents"("user_id", "type");
CREATE INDEX IF NOT EXISTS "user_memberships_user_id_status_idx" ON "user_memberships"("user_id", "status");
CREATE INDEX IF NOT EXISTS "user_memberships_membership_id_status_idx" ON "user_memberships"("membership_id", "status");
