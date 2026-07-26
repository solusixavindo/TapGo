-- P1-4 Atomic quota untuk benefit Basic PPOB Rp5.000 (1.000 user pertama).
-- Mengganti pola rawan race `COUNT(users) < 1000` dengan counter row yang
-- diklaim atomik via conditional UPDATE ... RETURNING (row lock).
--
-- PRESERVASI DATA LAMA: granted awal diisi dari jumlah user role USER yang
-- sudah ada (capped 1000), sehingga kuota efektif TETAP 1.000 total, bukan
-- 1.000 tambahan. Aman untuk existing production database.

CREATE TABLE IF NOT EXISTS "registration_quota" (
  "key"        TEXT NOT NULL,
  "limit"      INTEGER NOT NULL,
  "granted"    INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "registration_quota_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "registration_quota_granted_nonneg" CHECK ("granted" >= 0),
  CONSTRAINT "registration_quota_within_limit" CHECK ("granted" <= "limit")
);

INSERT INTO "registration_quota" ("key", "limit", "granted")
VALUES (
  'BASIC_PPOB_FIRST_1000',
  1000,
  LEAST((SELECT COUNT(*) FROM "users" WHERE "role" = 'USER'), 1000)
)
ON CONFLICT ("key") DO NOTHING;
