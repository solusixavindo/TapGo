-- Stage 5.14B — Driver application schema foundation.
--
-- ADDITIVE ONLY. Migration ini HANYA menambah satu enum, satu tabel, index,
-- foreign key, dan constraint miliknya sendiri.
--
-- Sengaja TIDAK memuat statement `ALTER COLUMN "id" DROP DEFAULT` yang
-- dihasilkan `prisma migrate diff` untuk 16 tabel lama. Statement tersebut
-- adalah drift pre-existing antara migration history dan schema, terbukti
-- muncul identik (24 statement) pada diff schema baseline TANPA perubahan
-- Stage 5.14B. Menyertakannya akan mengubah tabel legacy dan finansial
-- (invoices, membership_payments, profit_sharing_*, reward_transactions),
-- yang berada di luar scope stage ini.

-- CreateEnum
CREATE TYPE "RideDriverApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "ride_driver_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "status" "RideDriverApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "decision_reason_code" VARCHAR(60),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ride_driver_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ride_driver_applications_status_created_at_idx" ON "ride_driver_applications"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ride_driver_applications_user_id_cycle_number_key" ON "ride_driver_applications"("user_id", "cycle_number");

-- AddForeignKey
ALTER TABLE "ride_driver_applications" ADD CONSTRAINT "ride_driver_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Objek berikut TIDAK dapat direpresentasikan Prisma secara deklaratif dan
-- karena itu ditulis sebagai raw SQL. Lihat komentar /// pada model
-- RideDriverApplication di schema.prisma.
-- ---------------------------------------------------------------------------

-- Satu open application per user, ditegakkan DATABASE (bukan hanya aplikasi).
-- Open states = DRAFT, SUBMITTED, UNDER_REVIEW (Stage 5.13 §6.1 butir 3).
-- Terminal states sengaja dikecualikan agar histori tetap boleh menumpuk.
CREATE UNIQUE INDEX "ride_driver_applications_one_open_per_user_key"
  ON "ride_driver_applications" ("user_id")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW');

-- Cycle dimulai dari 1; nol dan negatif ditolak.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_cycle_number_check"
  CHECK ("cycle_number" >= 1);

-- Optimistic lock tidak boleh negatif.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_version_check"
  CHECK ("version" >= 0);

-- Timestamp terminal terisi JIKA DAN HANYA JIKA statusnya sesuai.
-- Biconditional, sehingga approved_at tidak dapat terisi pada status DRAFT.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_approved_at_check"
  CHECK (("status" = 'APPROVED') = ("approved_at" IS NOT NULL));

ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_rejected_at_check"
  CHECK (("status" = 'REJECTED') = ("rejected_at" IS NOT NULL));

ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_withdrawn_at_check"
  CHECK (("status" = 'WITHDRAWN') = ("withdrawn_at" IS NOT NULL));

-- Satu cycle hanya boleh berakhir dengan satu cara.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_terminal_exclusive_check"
  CHECK (
    (CASE WHEN "approved_at"  IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "rejected_at"  IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "withdrawn_at" IS NOT NULL THEN 1 ELSE 0 END) <= 1
  );
