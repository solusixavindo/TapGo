-- Toleransi refresh token ganda yang berbarengan: simpan hash sebelum rotasi terakhir + waktunya,
-- agar permintaan duplikat dalam jendela singkat tidak mencabut seluruh sesi.
ALTER TABLE "sessions" ADD COLUMN "previous_refresh_token_hash" TEXT;
ALTER TABLE "sessions" ADD COLUMN "rotated_at" TIMESTAMP(3);
