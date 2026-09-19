-- HPP per paket membership + manfaat paket Silver, Gold, dan Platinum (keputusan klien).
ALTER TABLE "memberships"
  ADD COLUMN "hpp_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "hpp_breakdown" JSONB;

UPDATE "memberships"
SET
  "ppob_balance" = 100000,
  "bpjs_benefit" = 'BPJS Ketenagakerjaan JKK dan JKM (gratis 1 bulan, bulan berikutnya dibayar sendiri)',
  "merchandise" = '["Kaos TAPGO"]'::jsonb,
  "hpp_total" = 190000,
  "hpp_breakdown" = '[{"name": "Kaos TAPGO", "quantity": 1, "unit": "pcs", "cost": 70000}, {"name": "Saldo PPOB", "quantity": 1, "unit": "paket", "cost": 100000}, {"name": "BPJS JKK dan JKM (1 bulan)", "quantity": 1, "unit": "paket", "cost": 20000}]'::jsonb
WHERE "tier" = 'SILVER';

UPDATE "memberships"
SET
  "ppob_balance" = 600000,
  "bpjs_benefit" = 'BPJS Ketenagakerjaan JKK dan JKM 1 tahun',
  "merchandise" = '["Kaos TAPGO", "Rompi TAPGO", "Banner TAPGO"]'::jsonb,
  "hpp_total" = 1230000,
  "hpp_breakdown" = '[{"name": "Kaos TAPGO", "quantity": 1, "unit": "pcs", "cost": 70000}, {"name": "Rompi TAPGO", "quantity": 1, "unit": "pcs", "cost": 170000}, {"name": "Banner TAPGO", "quantity": 1, "unit": "pcs", "cost": 150000}, {"name": "Saldo PPOB", "quantity": 1, "unit": "paket", "cost": 600000}, {"name": "BPJS JKK dan JKM 1 tahun", "quantity": 1, "unit": "paket", "cost": 240000}]'::jsonb
WHERE "tier" = 'GOLD';

UPDATE "memberships"
SET
  "ppob_balance" = 1000000,
  "bpjs_benefit" = 'BPJS Ketenagakerjaan 1 tahun (JKK, JKM, JHT)',
  "merchandise" = '["Kaos TAPGO", "Rompi TAPGO", "Banner TAPGO"]'::jsonb,
  "hpp_total" = 1870000,
  "hpp_breakdown" = '[{"name": "Kaos TAPGO", "quantity": 1, "unit": "pcs", "cost": 70000}, {"name": "Rompi TAPGO", "quantity": 1, "unit": "pcs", "cost": 170000}, {"name": "Banner TAPGO", "quantity": 1, "unit": "pcs", "cost": 150000}, {"name": "Saldo PPOB", "quantity": 1, "unit": "paket", "cost": 1000000}, {"name": "BPJS JKK, JKM, JHT 1 tahun", "quantity": 1, "unit": "paket", "cost": 480000}]'::jsonb
WHERE "tier" = 'PLATINUM';
