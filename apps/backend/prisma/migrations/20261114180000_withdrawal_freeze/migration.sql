-- Pembekuan penarikan dana per akun (keputusan pemilik 14 Nov 2026).
-- Hanya menambah tiga kolom kosong (NULL = tidak dibekukan); tidak mengubah data apa pun.
ALTER TABLE "users"
  ADD COLUMN "withdrawal_frozen_at"     TIMESTAMP(3),
  ADD COLUMN "withdrawal_frozen_by"     UUID,
  ADD COLUMN "withdrawal_frozen_reason" VARCHAR(300);
