-- P1-1 Reproducible package benefits.
-- Menetapkan nilai final benefit per tier agar clean deployment deterministik
-- (tidak lagi bergantung pada seed lokal yang gitignored).
--
-- Idempotent: hanya UPDATE baris tier yang sudah ada (di-seed oleh 0005).
-- Semua nominal uang adalah integer rupiah pada kolom Decimal(14,2).
-- TIDAK mengubah formula sponsor/level/reward/profit-sharing dan TIDAK
-- menyentuh membership_benefits (tabel komisi level).

UPDATE "memberships" SET
  "price" = 0,
  "ppob_balance" = 0,
  "bpjs_benefit" = NULL,
  "merchandise" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "tier" = 'BASIC';

UPDATE "memberships" SET
  "price" = 500000,
  "ppob_balance" = 100000,
  "bpjs_benefit" = 'JKK, JKM',
  "merchandise" = '["Kaos TapGo"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "tier" = 'SILVER';

UPDATE "memberships" SET
  "price" = 3000000,
  "ppob_balance" = 600000,
  "bpjs_benefit" = 'JKK, JKM',
  "merchandise" = '["Kaos TapGo", "Jaket TapGo", "Banner TapGo"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "tier" = 'GOLD';

UPDATE "memberships" SET
  "price" = 5500000,
  "ppob_balance" = 1000000,
  "bpjs_benefit" = 'JKK, JKM, JHT',
  "merchandise" = '["Kaos TapGo", "Jaket TapGo"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "tier" = 'PLATINUM';
