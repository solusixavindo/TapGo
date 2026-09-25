-- Hapus total Program Founder (keputusan Owner, 2026-09-25).
--
-- FAIL-CLOSED: migrasi ini menolak berjalan bila masih ada data Founder, agar
-- tidak ada data uang/identitas yang hilang tanpa sengaja. Bila kedua hitungan
-- di bawah bukan nol, ekspor barisnya lebih dulu (pg_dump -t founder_program_grants)
-- lalu putuskan nasibnya secara eksplisit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "founder_program_grants") THEN
    RAISE EXCEPTION 'founder_program_grants masih berisi data; ekspor dan kosongkan sebelum menghapus Program Founder';
  END IF;
  IF EXISTS (SELECT 1 FROM "user_memberships" WHERE "founder_role" IS NOT NULL) THEN
    RAISE EXCEPTION 'user_memberships.founder_role masih terisi; tinjau akun terkait sebelum menghapus Program Founder';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "founder_program_grants" DROP CONSTRAINT "founder_program_grants_user_id_fkey";
ALTER TABLE "founder_program_grants" DROP CONSTRAINT "founder_program_grants_granted_by_fkey";
ALTER TABLE "founder_program_grants" DROP CONSTRAINT "founder_program_grants_membership_id_fkey";
ALTER TABLE "founder_program_grants" DROP CONSTRAINT "founder_program_grants_user_membership_id_fkey";

-- DropIndex
DROP INDEX "user_memberships_founder_role_status_idx";

-- AlterTable
ALTER TABLE "user_memberships" DROP COLUMN "founder_role";

-- DropTable
DROP TABLE "founder_program_grants";

-- DropEnum
DROP TYPE "FounderRole";
