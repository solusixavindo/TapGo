CREATE TYPE "GooglePlayProductType" AS ENUM ('ONE_TIME_NON_CONSUMABLE');

CREATE TYPE "GooglePlayPurchaseState" AS ENUM ('PENDING', 'PURCHASED', 'CANCELLED', 'UNKNOWN');

CREATE TYPE "GooglePlayAcknowledgementState" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'NOT_REQUIRED');

CREATE TYPE "GooglePlayEntitlementStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'REVOKED', 'REFUNDED', 'SUPERSEDED');

CREATE TYPE "GooglePlayNotificationProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

CREATE TABLE "google_play_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" VARCHAR(120) NOT NULL,
  "package_name" VARCHAR(160) NOT NULL,
  "membership_id" UUID NOT NULL,
  "product_type" "GooglePlayProductType" NOT NULL DEFAULT 'ONE_TIME_NON_CONSUMABLE',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "google_play_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_play_purchases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "google_play_product_id" UUID NOT NULL,
  "purchase_token_hash" VARCHAR(128) NOT NULL,
  "encrypted_purchase_token" TEXT NOT NULL,
  "google_order_id" VARCHAR(160),
  "purchase_state" "GooglePlayPurchaseState" NOT NULL,
  "acknowledgement_state" "GooglePlayAcknowledgementState" NOT NULL,
  "entitlement_status" "GooglePlayEntitlementStatus" NOT NULL,
  "client_request_id" UUID NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "refunded_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "google_play_purchases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_play_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" VARCHAR(160) NOT NULL,
  "notification_type" VARCHAR(120) NOT NULL,
  "purchase_token_hash" VARCHAR(128),
  "product_id" VARCHAR(120),
  "processing_status" "GooglePlayNotificationProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
  "processed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "google_play_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_play_products_product_id_key" ON "google_play_products"("product_id");
CREATE INDEX "google_play_products_membership_id_is_active_idx" ON "google_play_products"("membership_id", "is_active");
CREATE INDEX "google_play_products_package_name_is_active_idx" ON "google_play_products"("package_name", "is_active");

CREATE UNIQUE INDEX "google_play_purchases_purchase_token_hash_key" ON "google_play_purchases"("purchase_token_hash");
CREATE UNIQUE INDEX "google_play_purchases_google_order_id_key" ON "google_play_purchases"("google_order_id");
CREATE INDEX "google_play_purchases_user_id_entitlement_status_idx" ON "google_play_purchases"("user_id", "entitlement_status");
CREATE INDEX "google_play_purchases_google_play_product_id_purchase_state_idx" ON "google_play_purchases"("google_play_product_id", "purchase_state");
CREATE INDEX "google_play_purchases_membership_id_entitlement_status_idx" ON "google_play_purchases"("membership_id", "entitlement_status");
CREATE INDEX "google_play_purchases_verified_at_idx" ON "google_play_purchases"("verified_at");

CREATE UNIQUE INDEX "google_play_notifications_message_id_key" ON "google_play_notifications"("message_id");
CREATE INDEX "google_play_notifications_purchase_token_hash_processing_status_idx" ON "google_play_notifications"("purchase_token_hash", "processing_status");
CREATE INDEX "google_play_notifications_product_id_processing_status_idx" ON "google_play_notifications"("product_id", "processing_status");
CREATE INDEX "google_play_notifications_processing_status_created_at_idx" ON "google_play_notifications"("processing_status", "created_at");

ALTER TABLE "google_play_products"
  ADD CONSTRAINT "google_play_products_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "google_play_purchases"
  ADD CONSTRAINT "google_play_purchases_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "google_play_purchases"
  ADD CONSTRAINT "google_play_purchases_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "google_play_purchases"
  ADD CONSTRAINT "google_play_purchases_google_play_product_id_fkey"
  FOREIGN KEY ("google_play_product_id") REFERENCES "google_play_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
