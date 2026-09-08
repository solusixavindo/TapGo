/*
  Warnings:

  - You are about to drop the column `ride_id` on the `chat_messages` table. All the data in the column will be lost.
  - You are about to alter the column `message` on the `chat_messages` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(1000)`.
  - Added the required column `ride_order_id` to the `chat_messages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommissionType" ADD VALUE 'RIDE_DRIVER_EARNING';
ALTER TYPE "CommissionType" ADD VALUE 'RIDE_COMPANY_REVENUE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "WalletTransactionType" ADD VALUE 'TRANSFER_IN';

-- DropForeignKey
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_ride_id_fkey";

-- DropIndex
DROP INDEX "chat_messages_ride_id_created_at_idx";

-- AlterTable
ALTER TABLE "abuse_flags" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "account_deletion_requests" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "chat_messages" DROP COLUMN "ride_id",
ADD COLUMN     "ride_order_id" UUID NOT NULL,
ALTER COLUMN "message" SET DATA TYPE VARCHAR(1000);

-- AlterTable
ALTER TABLE "contact_messages" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "driver_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "founder_program_grants" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invoices" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "member_identities" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "membership_documents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "membership_orders" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "membership_payments" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "profit_sharing_distributions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "profit_sharing_periods" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "registration_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "reward_transactions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "support_ticket_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "support_tickets" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_memberships" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "wallet_topup_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "method" VARCHAR(60),
    "provider" VARCHAR(60),
    "provider_reference" VARCHAR(120),
    "metadata" JSONB,
    "paid_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_topup_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transfers" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(24) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(140),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topup_orders_reference_key" ON "wallet_topup_orders"("reference");

-- CreateIndex
CREATE INDEX "wallet_topup_orders_user_id_status_idx" ON "wallet_topup_orders"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transfers_public_reference_key" ON "wallet_transfers"("public_reference");

-- CreateIndex
CREATE INDEX "wallet_transfers_from_user_id_created_at_idx" ON "wallet_transfers"("from_user_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transfers_to_user_id_created_at_idx" ON "wallet_transfers"("to_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transfers_from_user_id_idempotency_key_key" ON "wallet_transfers"("from_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "chat_messages_ride_order_id_created_at_idx" ON "chat_messages"("ride_order_id", "created_at");

-- AddForeignKey
ALTER TABLE "wallet_topup_orders" ADD CONSTRAINT "wallet_topup_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ride_order_id_fkey" FOREIGN KEY ("ride_order_id") REFERENCES "ride_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
