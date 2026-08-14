-- Stage R2.2 / 5.14C — admin review scope dan claim/lease.
--
-- ADDITIVE ONLY. Menambah dua enum, satu tabel, tujuh kolom nullable pada
-- ride_driver_applications, index, foreign key, partial unique index, dan
-- CHECK constraint. Nol kolom di-drop, nol data diubah, nol tabel finansial
-- atau membership disentuh.
--
-- 24 statement `ALTER COLUMN "id" DROP DEFAULT` yang dihasilkan generator
-- sengaja tidak disertakan: drift pre-existing, terbukti identik dengan
-- baseline.
--
-- Seluruh FK reviewer memakai RESTRICT/SET NULL, tidak pernah CASCADE:
-- menghapus akun aktor tidak boleh menghapus jejak review.

-- CreateEnum
CREATE TYPE "AdminScope" AS ENUM ('DRIVER_APPLICATION_QUEUE_READ', 'DRIVER_APPLICATION_CLAIM', 'DRIVER_APPLICATION_RENEW', 'DRIVER_APPLICATION_RELEASE', 'DRIVER_APPLICATION_REASSIGN');

-- CreateEnum
CREATE TYPE "AdminScopeGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');














ALTER TABLE "ride_driver_applications" ADD COLUMN     "claim_expires_at" TIMESTAMP(3),
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "claimed_by_id" UUID,
ADD COLUMN     "release_reason_code" VARCHAR(60),
ADD COLUMN     "released_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" UUID;




-- CreateTable
CREATE TABLE "admin_scope_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" "AdminScope" NOT NULL,
    "status" "AdminScopeGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "granted_by_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "reason_code" VARCHAR(60),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_scope_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_scope_grants_user_id_scope_status_idx" ON "admin_scope_grants"("user_id", "scope", "status");

-- CreateIndex
CREATE INDEX "admin_scope_grants_scope_status_idx" ON "admin_scope_grants"("scope", "status");

-- CreateIndex
CREATE INDEX "ride_driver_applications_status_claim_expires_at_idx" ON "ride_driver_applications"("status", "claim_expires_at");

-- CreateIndex
CREATE INDEX "ride_driver_applications_claimed_by_id_claim_expires_at_idx" ON "ride_driver_applications"("claimed_by_id", "claim_expires_at");

-- AddForeignKey
ALTER TABLE "admin_scope_grants" ADD CONSTRAINT "admin_scope_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_scope_grants" ADD CONSTRAINT "admin_scope_grants_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_scope_grants" ADD CONSTRAINT "admin_scope_grants_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_driver_applications" ADD CONSTRAINT "ride_driver_applications_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_driver_applications" ADD CONSTRAINT "ride_driver_applications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Objek yang tidak dapat direpresentasikan Prisma secara deklaratif.
-- ---------------------------------------------------------------------------

-- Satu grant AKTIF per (user, scope), ditegakkan DATABASE. Grant yang sudah
-- dicabut keluar dari predikat sehingga riwayat boleh menumpuk penuh.
CREATE UNIQUE INDEX "admin_scope_grants_one_active_per_scope_key"
  ON "admin_scope_grants" ("user_id", "scope")
  WHERE "status" = 'ACTIVE';

-- Pencabutan harus lengkap: status REVOKED berpasangan dengan waktu
-- pencabutannya, dan sebaliknya. Mencegah baris setengah-tercabut yang
-- lolos dari pemeriksaan scope.
ALTER TABLE "admin_scope_grants"
  ADD CONSTRAINT "admin_scope_grants_revocation_pair_check"
  CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL));

-- Trio field klaim hidup dan mati bersama. Tidak boleh ada aplikasi yang
-- ter-klaim tanpa pemilik, atau punya batas lease tanpa klaim.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_claim_trio_check"
  CHECK (
    ("claimed_by_id" IS NULL) = ("claimed_at" IS NULL)
    AND ("claimed_by_id" IS NULL) = ("claim_expires_at" IS NULL)
  );

-- Pelepasan wajib menyertakan kode alasan yang terbatas.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_release_pair_check"
  CHECK (("released_at" IS NULL) = ("release_reason_code" IS NULL));

-- Jejak reviewer juga berpasangan.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_reviewed_pair_check"
  CHECK (("reviewed_by_id" IS NULL) = ("reviewed_at" IS NULL));
