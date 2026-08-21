-- CreateEnum
CREATE TYPE "PpobCategory" AS ENUM ('PULSA', 'DATA', 'PLN_PREPAID', 'PLN_POSTPAID', 'BPJS', 'EWALLET');

-- CreateEnum
CREATE TYPE "PpobTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionType" ADD VALUE 'PPOB_PURCHASE';
ALTER TYPE "WalletTransactionType" ADD VALUE 'PPOB_REFUND';

-- CreateTable
CREATE TABLE "ppob_products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "category" "PpobCategory" NOT NULL,
    "brand" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(240),
    "price" DECIMAL(14,2) NOT NULL,
    "admin_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppob_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppob_transactions" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(24) NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku_snapshot" VARCHAR(40) NOT NULL,
    "product_name_snapshot" VARCHAR(120) NOT NULL,
    "brand_snapshot" VARCHAR(40) NOT NULL,
    "category" "PpobCategory" NOT NULL,
    "target_number" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "admin_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "status" "PpobTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(20) NOT NULL,
    "provider_reference" VARCHAR(64),
    "serial_number" VARCHAR(120),
    "failure_code" VARCHAR(40),
    "failure_reason" VARCHAR(240),
    "idempotency_key" VARCHAR(120),
    "wallet_transaction_id" UUID,
    "refund_transaction_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppob_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ppob_products_sku_key" ON "ppob_products"("sku");

-- CreateIndex
CREATE INDEX "ppob_products_category_is_active_sort_order_idx" ON "ppob_products"("category", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ppob_transactions_public_reference_key" ON "ppob_transactions"("public_reference");

-- CreateIndex
CREATE INDEX "ppob_transactions_user_id_created_at_idx" ON "ppob_transactions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ppob_transactions_status_created_at_idx" ON "ppob_transactions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ppob_transactions_user_id_idempotency_key_key" ON "ppob_transactions"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "ppob_transactions" ADD CONSTRAINT "ppob_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppob_transactions" ADD CONSTRAINT "ppob_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ppob_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
