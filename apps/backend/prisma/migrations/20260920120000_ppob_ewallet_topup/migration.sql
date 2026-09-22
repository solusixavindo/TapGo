-- Perluasan katalog PPOB: top up e-wallet (DANA, GoPay, OVO, ShopeePay).
-- Memperbaiki bug Super Menu (tile "E-Wallet" tanpa produk aktif jatuh ke
-- katalog umum) DENGAN benar-benar mengaktifkan kategori ini, bukan hanya
-- menyembunyikan gejalanya. Harga dihitung dengan rumus yang sama dengan
-- PpobPriceSyncService (core/finance/ppobPricing.ts): harga modal Digiflazz
-- dibulatkan naik ke kelipatan Rp500 terdekat yang margin-nya di [Rp500,
-- Rp1.000] — kelima kolom di bawah akan disinkronkan ulang otomatis oleh
-- worker sinkronisasi harga begitu diaktifkan (PPOB_PRICE_SYNC_ENABLED).
--
-- "Cek Nama Pengguna DANA" (danacek) BUKAN top up — dilewati.
INSERT INTO "ppob_products"
  ("id","sku","category","brand","name","description","price","admin_fee","provider_sku","is_active","sort_order","created_at","updated_at")
VALUES
  (gen_random_uuid(),'EWALLET_DANA_20K','EWALLET','DANA','DANA Rp20.000','Top up saldo DANA Rp20.000. Nomor tujuan harus terdaftar di DANA.',21000,0,'dana20',true,1,now(),now()),
  (gen_random_uuid(),'EWALLET_DANA_50K','EWALLET','DANA','DANA Rp50.000','Top up saldo DANA Rp50.000. Nomor tujuan harus terdaftar di DANA.',51000,0,'dana50',true,2,now(),now()),
  (gen_random_uuid(),'EWALLET_GOPAY_50K','EWALLET','GoPay','GoPay Rp50.000','Top up saldo GoPay Rp50.000. Nomor tujuan harus terdaftar di GoPay.',52500,0,'go50',true,3,now(),now()),
  (gen_random_uuid(),'EWALLET_GOPAY_100K','EWALLET','GoPay','GoPay Rp100.000','Top up saldo GoPay Rp100.000. Nomor tujuan harus terdaftar di GoPay.',102500,0,'go100',true,4,now(),now()),
  (gen_random_uuid(),'EWALLET_OVO_50K','EWALLET','OVO','OVO Rp50.000','Top up saldo OVO Rp50.000. Nomor tujuan harus terdaftar di OVO.',52000,0,'ovo50',true,5,now(),now()),
  (gen_random_uuid(),'EWALLET_OVO_100K','EWALLET','OVO','OVO Rp100.000','Top up saldo OVO Rp100.000. Nomor tujuan harus terdaftar di OVO.',102000,0,'ovo100',true,6,now(),now()),
  (gen_random_uuid(),'EWALLET_SHOPEEPAY_50K','EWALLET','ShopeePay','ShopeePay Rp50.000','Top up saldo ShopeePay Rp50.000. Nomor tujuan harus terdaftar di ShopeePay.',52000,0,'shopee50',true,7,now(),now()),
  (gen_random_uuid(),'EWALLET_SHOPEEPAY_100K','EWALLET','ShopeePay','ShopeePay Rp100.000','Top up saldo ShopeePay Rp100.000. Nomor tujuan harus terdaftar di ShopeePay.',102000,0,'shopee100',true,8,now(),now())
ON CONFLICT ("sku") DO NOTHING;
