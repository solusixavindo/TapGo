-- Release 2.7 — PPOB Foundation (additive, backward-compatible).

-- AlterEnum: jenis transaksi wallet baru untuk pembelian dan refund PPOB.
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'PPOB_PURCHASE';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'PPOB_REFUND';

-- CreateEnum
CREATE TYPE "PpobOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "ppob_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(200),
    "icon" VARCHAR(60),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppob_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppob_products" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "sku" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "price" DECIMAL(14,2) NOT NULL,
    "admin_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "target_label" VARCHAR(80) NOT NULL,
    "target_pattern" VARCHAR(160),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppob_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ppob_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "target_number" VARCHAR(60) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "benefit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PpobOrderStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" VARCHAR(200),
    "provider_ref" VARCHAR(120),
    "idempotency_key" VARCHAR(120) NOT NULL,
    "wallet_transaction_id" UUID,
    "paid_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ppob_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ppob_categories_code_key" ON "ppob_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ppob_products_sku_key" ON "ppob_products"("sku");

-- CreateIndex
CREATE INDEX "ppob_products_category_active_sort_idx" ON "ppob_products"("category_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ppob_orders_user_idempotency_key" ON "ppob_orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ppob_orders_wallet_transaction_id_key" ON "ppob_orders"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "ppob_orders_user_created_idx" ON "ppob_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ppob_orders_status_created_idx" ON "ppob_orders"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ppob_products" ADD CONSTRAINT "ppob_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ppob_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppob_orders" ADD CONSTRAINT "ppob_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppob_orders" ADD CONSTRAINT "ppob_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ppob_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppob_orders" ADD CONSTRAINT "ppob_orders_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Katalog seed (idempotent, ON CONFLICT DO UPDATE). Harga retail foundation;
-- SKU digantikan produk biller nyata pada Stage R2.8.
INSERT INTO "ppob_categories" ("id", "code", "name", "description", "icon", "sort_order", "is_active", "updated_at")
VALUES
  (gen_random_uuid(), 'PULSA', 'Pulsa', 'Isi ulang pulsa reguler semua operator.', 'phone_iphone', 1, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DATA', 'Paket Data', 'Paket internet semua operator.', 'wifi', 2, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PLN_TOKEN', 'Token PLN', 'Token listrik prabayar PLN.', 'bolt', 3, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BPJS', 'BPJS', 'Iuran BPJS Kesehatan dan Ketenagakerjaan.', 'health_and_safety', 4, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PDAM', 'PDAM', 'Tagihan air PDAM.', 'water_drop', 5, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EMONEY', 'E-Money', 'Top up dompet elektronik.', 'account_balance_wallet', 6, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "icon" = EXCLUDED."icon",
    "sort_order" = EXCLUDED."sort_order",
    "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "ppob_products" ("id", "category_id", "sku", "name", "description", "price", "admin_fee", "target_label", "target_pattern", "sort_order", "is_active", "updated_at")
SELECT gen_random_uuid(), c."id", p.sku, p.name, p.description, p.price, p.admin_fee, p.target_label, p.target_pattern, p.sort_order, true, CURRENT_TIMESTAMP
FROM "ppob_categories" c
JOIN (
  VALUES
    ('PULSA', 'PULSA_5K',  'Pulsa Rp5.000',   'Pulsa reguler Rp5.000 semua operator.',   6500::DECIMAL,  0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 1),
    ('PULSA', 'PULSA_10K', 'Pulsa Rp10.000',  'Pulsa reguler Rp10.000 semua operator.',  11500::DECIMAL, 0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 2),
    ('PULSA', 'PULSA_20K', 'Pulsa Rp20.000',  'Pulsa reguler Rp20.000 semua operator.',  21500::DECIMAL, 0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 3),
    ('PULSA', 'PULSA_50K', 'Pulsa Rp50.000',  'Pulsa reguler Rp50.000 semua operator.',  51000::DECIMAL, 0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 4),
    ('PULSA', 'PULSA_100K','Pulsa Rp100.000', 'Pulsa reguler Rp100.000 semua operator.', 101000::DECIMAL,0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 5),
    ('DATA',  'DATA_1GB',  'Paket Data 1 GB', 'Paket internet 1 GB semua operator.',     12000::DECIMAL, 0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 1),
    ('DATA',  'DATA_5GB',  'Paket Data 5 GB', 'Paket internet 5 GB semua operator.',     43000::DECIMAL, 0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 2),
    ('DATA',  'DATA_10GB', 'Paket Data 10 GB','Paket internet 10 GB semua operator.',    78000::DECIMAL, 0::DECIMAL, 'Nomor HP', '^[0-9]{10,15}$', 3),
    ('PLN_TOKEN', 'PLN_20K',  'Token PLN Rp20.000',  'Token listrik prabayar Rp20.000.',  21500::DECIMAL,  0::DECIMAL, 'ID Pelanggan / Nomor Meter', '^[0-9]{11,12}$', 1),
    ('PLN_TOKEN', 'PLN_50K',  'Token PLN Rp50.000',  'Token listrik prabayar Rp50.000.',  51500::DECIMAL,  0::DECIMAL, 'ID Pelanggan / Nomor Meter', '^[0-9]{11,12}$', 2),
    ('PLN_TOKEN', 'PLN_100K', 'Token PLN Rp100.000', 'Token listrik prabayar Rp100.000.', 101500::DECIMAL, 0::DECIMAL, 'ID Pelanggan / Nomor Meter', '^[0-9]{11,12}$', 3),
    ('PLN_TOKEN', 'PLN_200K', 'Token PLN Rp200.000', 'Token listrik prabayar Rp200.000.', 201500::DECIMAL, 0::DECIMAL, 'ID Pelanggan / Nomor Meter', '^[0-9]{11,12}$', 4),
    ('BPJS', 'BPJS_IURAN_1BULAN', 'Iuran BPJS Kesehatan 1 Bulan', 'Iuran BPJS Kesehatan 1 bulan per orang.', 42000::DECIMAL, 2500::DECIMAL, 'Nomor VA BPJS', '^[0-9]{8,20}$', 1),
    ('PDAM', 'PDAM_50K',  'Tagihan PDAM Rp50.000',  'Pembayaran tagihan air PDAM nominal Rp50.000.',  50000::DECIMAL, 3000::DECIMAL, 'ID Pelanggan PDAM', '^[0-9]{6,20}$', 1),
    ('PDAM', 'PDAM_100K', 'Tagihan PDAM Rp100.000', 'Pembayaran tagihan air PDAM nominal Rp100.000.', 100000::DECIMAL, 3000::DECIMAL, 'ID Pelanggan PDAM', '^[0-9]{6,20}$', 2),
    ('EMONEY', 'EMONEY_20K',  'E-Money Rp20.000',  'Top up e-money Rp20.000.',  21500::DECIMAL,  0::DECIMAL, 'Nomor HP / ID Dompet', '^[0-9]{8,16}$', 1),
    ('EMONEY', 'EMONEY_50K',  'E-Money Rp50.000',  'Top up e-money Rp50.000.',  51500::DECIMAL,  0::DECIMAL, 'Nomor HP / ID Dompet', '^[0-9]{8,16}$', 2),
    ('EMONEY', 'EMONEY_100K', 'E-Money Rp100.000', 'Top up e-money Rp100.000.', 101500::DECIMAL, 0::DECIMAL, 'Nomor HP / ID Dompet', '^[0-9]{8,16}$', 3)
) AS p(sku_cat, sku, name, description, price, admin_fee, target_label, target_pattern, sort_order) ON c."code" = p.sku_cat
ON CONFLICT ("sku") DO UPDATE
SET "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "price" = EXCLUDED."price",
    "admin_fee" = EXCLUDED."admin_fee",
    "target_label" = EXCLUDED."target_label",
    "target_pattern" = EXCLUDED."target_pattern",
    "sort_order" = EXCLUDED."sort_order",
    "updated_at" = CURRENT_TIMESTAMP;
