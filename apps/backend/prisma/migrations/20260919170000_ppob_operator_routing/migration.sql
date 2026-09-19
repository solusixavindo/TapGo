-- Rute PPOB per operator + penyesuaian katalog (keputusan owner 19 Sep 2026),
-- dicek terhadap price-list Digiflazz production.

-- 1) Skema: peta kode provider per operator (produk) dan kode yang dipakai (transaksi).
ALTER TABLE "ppob_products" ADD COLUMN "provider_skus" JSONB;
ALTER TABLE "ppob_transactions" ADD COLUMN "provider_sku" VARCHAR(60);

-- 2) Harga baru agar margin tidak negatif (modal Digiflazz: PLN20K 21.650, PLN50K 51.784, Flash 1GB 15.160).
UPDATE "ppob_products" SET "price" = 22500 WHERE "sku" = 'PLN_20K';
UPDATE "ppob_products" SET "price" = 52500 WHERE "sku" = 'PLN_50K';
UPDATE "ppob_products" SET "price" = 16500 WHERE "sku" = 'DATA_1GB';

-- 3) Pemetaan tunggal: PLN.
UPDATE "ppob_products" SET "provider_sku" = 'pln20' WHERE "sku" = 'PLN_20K';
UPDATE "ppob_products" SET "provider_sku" = 'pln50' WHERE "sku" = 'PLN_50K';

-- 4) Pulsa: kode per operator, hanya kombinasi yang margin-nya tidak negatif.
--    Indosat 5K/10K (modal di atas harga jual) dan by.U (prefiks sama dengan Telkomsel) tidak dirutekan.
UPDATE "ppob_products" SET "provider_sku" = NULL, "brand" = 'Multi-operator', "provider_skus" = CASE "sku"
  WHEN 'PULSA_5K'   THEN '{"telkomsel":"s5","axis":"ax5","tri":"t5","xl":"x5"}'::jsonb
  WHEN 'PULSA_10K'  THEN '{"telkomsel":"s10","axis":"ax10","tri":"t10","xl":"x10","smartfren":"sm10"}'::jsonb
  WHEN 'PULSA_20K'  THEN '{"telkomsel":"s20","indosat":"i20","tri":"t20"}'::jsonb
  WHEN 'PULSA_50K'  THEN '{"telkomsel":"s50","indosat":"i50"}'::jsonb
  WHEN 'PULSA_100K' THEN '{"telkomsel":"s100"}'::jsonb
END
WHERE "sku" IN ('PULSA_5K','PULSA_10K','PULSA_20K','PULSA_50K','PULSA_100K');

UPDATE "ppob_products" SET "description" = CASE "sku"
  WHEN 'PULSA_5K'   THEN 'Pulsa reguler Rp5.000. Tersedia untuk Telkomsel, Axis, Tri, dan XL.'
  WHEN 'PULSA_10K'  THEN 'Pulsa reguler Rp10.000. Tersedia untuk Telkomsel, Axis, Tri, XL, dan Smartfren.'
  WHEN 'PULSA_20K'  THEN 'Pulsa reguler Rp20.000. Tersedia untuk Telkomsel, Indosat, dan Tri.'
  WHEN 'PULSA_50K'  THEN 'Pulsa reguler Rp50.000. Tersedia untuk Telkomsel dan Indosat.'
  WHEN 'PULSA_100K' THEN 'Pulsa reguler Rp100.000. Tersedia untuk Telkomsel.'
END
WHERE "sku" IN ('PULSA_5K','PULSA_10K','PULSA_20K','PULSA_50K','PULSA_100K');

-- 5) Data 1 GB = Telkomsel Data Flash 1 GB (30 hari), hanya Telkomsel.
UPDATE "ppob_products" SET
  "provider_sku" = NULL,
  "provider_skus" = '{"telkomsel":"flash1"}'::jsonb,
  "brand" = 'Telkomsel',
  "name" = 'Paket Data 1 GB Telkomsel',
  "description" = 'Telkomsel Data Flash 1 GB, berlaku 30 hari. Hanya untuk nomor Telkomsel.'
WHERE "sku" = 'DATA_1GB';

-- 6) Sembunyikan produk yang belum bisa dipenuhi provider (tidak dihapus; bisa diaktifkan lagi).
UPDATE "ppob_products" SET "is_active" = false WHERE "sku" IN (
  'PLN_200K', 'DATA_5GB', 'DATA_10GB', 'BPJS_IURAN_1BULAN',
  'PDAM_50K', 'PDAM_100K', 'EMONEY_20K', 'EMONEY_50K', 'EMONEY_100K'
);
