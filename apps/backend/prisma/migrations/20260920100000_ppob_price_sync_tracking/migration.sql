-- Jejak waktu sinkronisasi harga PPOB terakhir (per produk). Dipakai admin
-- untuk melihat produk mana yang belum pernah/lama tidak disinkron.
ALTER TABLE "ppob_products" ADD COLUMN "price_synced_at" TIMESTAMP(3);
