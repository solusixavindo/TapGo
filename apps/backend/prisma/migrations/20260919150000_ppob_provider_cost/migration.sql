-- Harga modal provider pada transaksi PPOB sukses (dasar HPP PPOB di laporan laba rugi).
ALTER TABLE "ppob_transactions" ADD COLUMN "provider_cost" DECIMAL(14,2);
