-- Stage R2.3 — scope ADMIN_SCOPE_MANAGE.
--
-- ADDITIVE ONLY: satu nilai enum baru. Nol tabel dibuat, nol kolom diubah,
-- nol data disentuh.
--
-- SENGAJA TIDAK ADA BACKFILL. Migration ini tidak memberikan grant kepada
-- siapa pun, termasuk SUPER_ADMIN yang sudah ada. Pemegang pertama hanya
-- dapat dibuat lewat CLI bootstrap sekali pakai yang dijalankan operator,
-- sehingga tidak ada jalur di mana penerapan migration diam-diam menciptakan
-- otoritas keamanan.
--
-- Nol tabel membership, finansial, maupun ride disentuh. 24 statement
-- `ALTER COLUMN "id" DROP DEFAULT` drift pre-existing tidak disertakan.
--
-- ADD VALUE dijalankan sendiri tanpa dipakai pada migration yang sama,
-- mengikuti preseden 0016_founder_chairman_unique_guard.

ALTER TYPE "AdminScope" ADD VALUE IF NOT EXISTS 'ADMIN_SCOPE_MANAGE';
