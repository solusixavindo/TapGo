-- Pemetaan katalog PPOB ke kode produk Digiflazz (buyer_sku_code), dicek terhadap
-- price-list Digiflazz production pada 19 Sep 2026. Hanya produk yang PUNYA padanan
-- dan margin-nya tidak negatif yang dipetakan:
--   Pulsa Telkomsel 5K/10K/20K/50K/100K -> s5/s10/s20/s50/s100
--   Token PLN 100K                      -> pln100
-- Belum dipetakan (perlu keputusan harga/produk): PLN 20K & 50K (modal di atas harga
-- jual), Data 1 GB (modal di atas harga jual), PLN 200K, Data 5/10 GB, BPJS, PDAM,
-- E-Money generik (Digiflazz menjual per dompet: DANA/OVO/GoPay/ShopeePay).
-- Hanya mengisi baris yang masih kosong; tidak mengubah harga atau status produk.
UPDATE "ppob_products" SET "provider_sku" = CASE "sku"
  WHEN 'PULSA_5K'   THEN 's5'
  WHEN 'PULSA_10K'  THEN 's10'
  WHEN 'PULSA_20K'  THEN 's20'
  WHEN 'PULSA_50K'  THEN 's50'
  WHEN 'PULSA_100K' THEN 's100'
  WHEN 'PLN_100K'   THEN 'pln100'
END
WHERE "sku" IN ('PULSA_5K','PULSA_10K','PULSA_20K','PULSA_50K','PULSA_100K','PLN_100K')
  AND "provider_sku" IS NULL;
