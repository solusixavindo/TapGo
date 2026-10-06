-- PPOB pascabayar (BPJS, PDAM): penanda produk dan tabel hasil cek tagihan.
-- Aditif: kolom baru bernilai bawaan konstan dan tabel baru; tidak mengubah baris yang ada.
-- AlterTable
ALTER TABLE "ppob_products" ADD COLUMN     "is_postpaid" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ppob_bill_inquiries" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(24) NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "target_number" VARCHAR(40) NOT NULL,
    "customer_name" VARCHAR(120) NOT NULL,
    "period" VARCHAR(40),
    "bill_amount" DECIMAL(14,2) NOT NULL,
    "provider_admin" DECIMAL(14,2) NOT NULL,
    "provider_cost" DECIMAL(14,2) NOT NULL,
    "service_fee" DECIMAL(14,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "detail" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ppob_bill_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ppob_bill_inquiries_public_reference_key" ON "ppob_bill_inquiries"("public_reference");

-- CreateIndex
CREATE INDEX "ppob_bill_inquiries_user_id_created_at_idx" ON "ppob_bill_inquiries"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ppob_bill_inquiries" ADD CONSTRAINT "ppob_bill_inquiries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ppob_bill_inquiries" ADD CONSTRAINT "ppob_bill_inquiries_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "ppob_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Angka cek tagihan tidak boleh tidak masuk akal (pertahanan terakhir di database).
ALTER TABLE "ppob_bill_inquiries" ADD CONSTRAINT "ppob_bill_inquiries_amounts_check"
  CHECK ("bill_amount" >= 0 AND "provider_admin" >= 0 AND "provider_cost" > 0 AND "service_fee" >= 0 AND "total_amount" > 0 AND "total_amount" >= "provider_cost");
