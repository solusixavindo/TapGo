-- PPOB commerce foundation for Digiflazz sandbox.
-- This is separate from wallet.ppob_balance and PPOB_BENEFIT management-engine liability.

CREATE TYPE "PpobProvider" AS ENUM ('DIGIFLAZZ');

CREATE TYPE "PpobTransactionStatus" AS ENUM (
  'CREATED',
  'AWAITING_PAYMENT',
  'PAID',
  'SUBMITTED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'EXPIRED',
  'REVERSAL_PENDING',
  'REFUNDED'
);

CREATE TYPE "PpobPaymentStatus" AS ENUM (
  'UNPAID',
  'PAID',
  'EXPIRED',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED'
);

CREATE TYPE "PpobProviderEventStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'DUPLICATE',
  'REJECTED',
  'UNKNOWN_REFERENCE'
);

CREATE TABLE "ppob_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "PpobProvider" NOT NULL,
  "provider_sku_code" VARCHAR(80) NOT NULL,
  "product_name" VARCHAR(160) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "brand" VARCHAR(80) NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "cost_price" INTEGER NOT NULL,
  "selling_price" INTEGER NOT NULL,
  "buyer_product_active" BOOLEAN NOT NULL DEFAULT false,
  "seller_product_active" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "unlimited_stock" BOOLEAN NOT NULL DEFAULT false,
  "stock" INTEGER,
  "description" TEXT,
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ppob_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ppob_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "client_request_id" VARCHAR(120) NOT NULL,
  "provider" "PpobProvider" NOT NULL DEFAULT 'DIGIFLAZZ',
  "provider_reference" VARCHAR(120) NOT NULL,
  "destination_encrypted" TEXT NOT NULL,
  "destination_masked" VARCHAR(48) NOT NULL,
  "cost_price" INTEGER NOT NULL,
  "selling_price" INTEGER NOT NULL,
  "admin_fee" INTEGER NOT NULL DEFAULT 0,
  "status" "PpobTransactionStatus" NOT NULL DEFAULT 'CREATED',
  "provider_response_code" VARCHAR(40),
  "provider_message" VARCHAR(500),
  "serial_number_encrypted" TEXT,
  "serial_number_masked" VARCHAR(80),
  "payment_status" "PpobPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "paid_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ppob_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ppob_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ppob_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ppob_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ppob_provider_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "PpobProvider" NOT NULL,
  "event_identity" VARCHAR(160) NOT NULL,
  "provider_reference" VARCHAR(120),
  "event_type" VARCHAR(80) NOT NULL,
  "payload_redacted" JSONB NOT NULL,
  "processing_status" "PpobProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ppob_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ppob_products_provider_provider_sku_code_key" ON "ppob_products"("provider", "provider_sku_code");
CREATE INDEX "ppob_products_provider_category_brand_idx" ON "ppob_products"("provider", "category", "brand");
CREATE INDEX "ppob_products_is_active_category_idx" ON "ppob_products"("is_active", "category");
CREATE INDEX "ppob_products_updated_at_idx" ON "ppob_products"("updated_at");

CREATE UNIQUE INDEX "ppob_transactions_user_id_client_request_id_key" ON "ppob_transactions"("user_id", "client_request_id");
CREATE UNIQUE INDEX "ppob_transactions_provider_provider_reference_key" ON "ppob_transactions"("provider", "provider_reference");
CREATE INDEX "ppob_transactions_user_id_status_created_at_idx" ON "ppob_transactions"("user_id", "status", "created_at");
CREATE INDEX "ppob_transactions_product_id_status_idx" ON "ppob_transactions"("product_id", "status");
CREATE INDEX "ppob_transactions_provider_reference_idx" ON "ppob_transactions"("provider_reference");
CREATE INDEX "ppob_transactions_payment_status_status_idx" ON "ppob_transactions"("payment_status", "status");
CREATE INDEX "ppob_transactions_created_at_idx" ON "ppob_transactions"("created_at");

CREATE UNIQUE INDEX "ppob_provider_events_provider_event_identity_key" ON "ppob_provider_events"("provider", "event_identity");
CREATE INDEX "ppob_provider_events_provider_reference_idx" ON "ppob_provider_events"("provider_reference");
CREATE INDEX "ppob_provider_events_processing_status_created_at_idx" ON "ppob_provider_events"("processing_status", "created_at");
