-- Kategori pascabayar tambahan (keputusan Owner 6 Okt 2026): BPJS Ketenagakerjaan, Telkom,
-- internet, TV kabel, HP pascabayar, multifinance, PBB, gas, dan e-money.
-- Hanya menambah nilai enum; tidak mengubah baris yang ada.
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'BPJS_TK';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'TELKOM';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'INTERNET';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'TV';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'HP_POSTPAID';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'MULTIFINANCE';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'PBB';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'GAS';
ALTER TYPE "PpobCategory" ADD VALUE IF NOT EXISTS 'EMONEY';
