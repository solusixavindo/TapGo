-- Perluasan katalog paket data (keputusan Owner 14 Okt 2026: "user punya pilihan lebih banyak"; sebelumnya hanya
-- Telkomsel Data Flash 1 GB). Daftar dan kode diambil dari daftar harga Digiflazz akun TapGo (cmd prepaid, kategori
-- Data, tersedia di sisi pembeli dan penjual pada 14 Okt 2026). Setiap paket dibatasi ke operatornya lewat
-- `provider_skus` ({operator: kode}); aplikasi dan backend menolak nomor operator lain sebelum saldo didebit.
--
-- Harga awal = harga jual terkecil kelipatan Rp100 yang menghasilkan untung bersih >= Rp500 (core/finance/ppobPricing.ts,
-- PPN atas selisih + PPh final), sama persis dengan hasil sinkronisasi; sinkronisasi harga berikutnya menghitung ulang
-- dari modal terbaru. Tidak mengubah produk yang sudah ada (ON CONFLICT DO NOTHING).
--   modal -> jual: flash2 21.925 -> 22.700; flash3 27.925 -> 28.700; if2 14.410 -> 15.100; if3g30d 30.250 -> 31.000;
--   if5g30d 30.225 -> 31.000; flexs 31.790 -> 32.600; axdss2 10.900 -> 11.600; axdj1 13.660 -> 14.300;
--   happy1 7.455 -> 8.100; happy3 12.490 -> 13.200; smdu1 22.210 -> 22.900.
INSERT INTO "ppob_products"
  ("id","sku","category","brand","name","description","price","admin_fee","provider_skus","is_active","sort_order","created_at","updated_at")
VALUES
  (gen_random_uuid(),'DATA_TSEL_FLASH2','DATA','Telkomsel','Telkomsel Data Flash 2 GB 30 Hari','Paket data Telkomsel Flash 2 GB, berlaku 30 hari. Hanya untuk nomor Telkomsel.',22700,0,'{"telkomsel":"flash2"}'::jsonb,true,2,now(),now()),
  (gen_random_uuid(),'DATA_TSEL_FLASH3','DATA','Telkomsel','Telkomsel Data Flash 3 GB 30 Hari','Paket data Telkomsel Flash 3 GB, berlaku 30 hari. Hanya untuk nomor Telkomsel.',28700,0,'{"telkomsel":"flash3"}'::jsonb,true,3,now(),now()),
  (gen_random_uuid(),'DATA_ISAT_FREEDOM_2G5','DATA','Indosat','Indosat Freedom Internet 2,5 GB 5 Hari','Paket data Indosat Freedom Internet 2,5 GB, berlaku 5 hari. Hanya untuk nomor Indosat.',15100,0,'{"indosat":"if2"}'::jsonb,true,4,now(),now()),
  (gen_random_uuid(),'DATA_ISAT_FREEDOM_3G','DATA','Indosat','Indosat Freedom Internet 3 GB 28 Hari','Paket data Indosat Freedom Internet 3 GB, berlaku 28 hari. Hanya untuk nomor Indosat.',31000,0,'{"indosat":"if3g30d"}'::jsonb,true,5,now(),now()),
  (gen_random_uuid(),'DATA_ISAT_FREEDOM_5G5','DATA','Indosat','Indosat Freedom Internet 5,5 GB 28 Hari','Paket data Indosat Freedom Internet 5,5 GB, berlaku 28 hari. Hanya untuk nomor Indosat.',31000,0,'{"indosat":"if5g30d"}'::jsonb,true,6,now(),now()),
  (gen_random_uuid(),'DATA_XL_FLEX_S','DATA','XL','XL Xtra Combo Flex S 28 Hari','Paket data XL Xtra Combo Flex S, berlaku 28 hari. Hanya untuk nomor XL.',32600,0,'{"xl":"flexs"}'::jsonb,true,7,now(),now()),
  (gen_random_uuid(),'DATA_AXIS_SS_2G','DATA','Axis','Axis Data SS 2 GB 3 Hari','Paket data Axis 2 GB, berlaku 3 hari. Hanya untuk nomor Axis.',11600,0,'{"axis":"axdss2"}'::jsonb,true,8,now(),now()),
  (gen_random_uuid(),'DATA_AXIS_JAWA_2G5','DATA','Axis','Axis Data Jawa 2,5 GB 5 Hari','Paket data Axis 2,5 GB, berlaku 5 hari. Khusus wilayah Jawa, Bali, dan Nusa Tenggara. Hanya untuk nomor Axis.',14300,0,'{"axis":"axdj1"}'::jsonb,true,9,now(),now()),
  (gen_random_uuid(),'DATA_TRI_HAPPY_1G5','DATA','Tri','Tri Data Happy 1,5 GB 1 Hari','Paket data Tri Happy 1,5 GB, berlaku 1 hari. Hanya untuk nomor Tri.',8100,0,'{"tri":"happy1"}'::jsonb,true,10,now(),now()),
  (gen_random_uuid(),'DATA_TRI_HAPPY_3G','DATA','Tri','Tri Data Happy 3 GB 3 Hari','Paket data Tri Happy 3 GB, berlaku 3 hari. Hanya untuk nomor Tri.',13200,0,'{"tri":"happy3"}'::jsonb,true,11,now(),now()),
  (gen_random_uuid(),'DATA_SMART_UNLI_1G','DATA','Smartfren','Smartfren Data Unlimited Harian 1 GB 7 Hari','Paket data Smartfren Unlimited Harian 1 GB, berlaku 7 hari. Hanya untuk nomor Smartfren.',22900,0,'{"smartfren":"smdu1"}'::jsonb,true,12,now(),now())
ON CONFLICT ("sku") DO NOTHING;
