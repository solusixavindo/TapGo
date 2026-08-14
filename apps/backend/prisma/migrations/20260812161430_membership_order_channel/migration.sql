-- Stage R2.6 jalur A: pelacakan kanal asal order membership.
--
-- Migrasi ini ditulis manual. Generator Prisma menyertakan 24 pernyataan
-- ALTER COLUMN ... DROP DEFAULT pada 16 tabel lain — termasuk invoices,
-- membership_payments, profit_sharing_periods, profit_sharing_distributions,
-- reward_transactions, dan user_memberships. Pernyataan itu adalah drift lama
-- yang sudah ada sebelum stage ini, bukan bagian dari perubahan R2.6.
-- Menyertakannya berarti mengubah tabel Business Engine tanpa alasan, jadi
-- seluruhnya dibuang dan hanya tiga pernyataan di bawah yang dipertahankan.

-- CreateEnum
CREATE TYPE "MembershipOrderChannel" AS ENUM ('WEB', 'APP', 'ADMIN');

-- AlterTable: nullable, karena order sebelum stage ini tidak diketahui kanalnya.
ALTER TABLE "membership_orders" ADD COLUMN "channel" "MembershipOrderChannel";

-- CreateIndex
CREATE INDEX "membership_orders_channel_status_idx" ON "membership_orders"("channel", "status");
