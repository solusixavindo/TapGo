-- Production hotfix — fondasi pemulihan akun dan verifikasi kontak.
--
-- ADDITIVE ONLY. Migration ini menambah tiga kolom nullable pada "users",
-- dua enum, satu tabel baru, index, foreign key, CHECK constraint, dan satu
-- trigger. Tidak ada kolom yang di-drop, tidak ada data yang diubah, tidak
-- ada tabel legacy atau finansial yang disentuh.
--
-- Statement `ALTER COLUMN "id" DROP DEFAULT` untuk 24 tabel lama yang
-- dihasilkan `prisma migrate diff` SENGAJA tidak disertakan: itu drift
-- pre-existing antara migration history dan schema, bukan bagian dari
-- perubahan ini.
--
-- CATATAN AKUN LEGACY: ketiga kolom baru sengaja dibiarkan NULL untuk seluruh
-- baris yang sudah ada. Tidak ada backfill, tidak ada auto-verify. Akun lama
-- harus membuktikan kepemilikan nomor/email lewat OTP.

-- CreateEnum
CREATE TYPE "AuthChallengePurpose" AS ENUM ('PASSWORD_RECOVERY', 'PHONE_VERIFICATION', 'EMAIL_VERIFICATION');

-- CreateEnum
CREATE TYPE "AuthChallengeChannel" AS ENUM ('PHONE', 'EMAIL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "phone_verified_at" TIMESTAMP(3),
ADD COLUMN     "sessions_revoked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "AuthChallengePurpose" NOT NULL,
    "channel" "AuthChallengeChannel" NOT NULL,
    "destination_digest" TEXT NOT NULL,
    "code_digest" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "reset_token_digest" TEXT,
    "reset_expires_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_challenges_user_id_purpose_consumed_at_idx" ON "auth_challenges"("user_id", "purpose", "consumed_at");

-- CreateIndex
CREATE INDEX "auth_challenges_expires_at_idx" ON "auth_challenges"("expires_at");

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Objek berikut tidak dapat direpresentasikan Prisma secara deklaratif.
-- ---------------------------------------------------------------------------

-- Satu tantangan aktif per (user, purpose), ditegakkan DATABASE.
-- Pengiriman ulang memperbarui baris yang sama; tantangan yang sudah
-- dikonsumsi keluar dari predikat sehingga histori boleh menumpuk.
CREATE UNIQUE INDEX "auth_challenges_one_active_per_purpose_key"
  ON "auth_challenges" ("user_id", "purpose")
  WHERE "consumed_at" IS NULL;

-- Lookup reset token saat langkah set-password.
CREATE INDEX "auth_challenges_reset_token_digest_idx"
  ON "auth_challenges" ("reset_token_digest")
  WHERE "reset_token_digest" IS NOT NULL;

ALTER TABLE "auth_challenges"
  ADD CONSTRAINT "auth_challenges_attempts_check"
  CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts");

ALTER TABLE "auth_challenges"
  ADD CONSTRAINT "auth_challenges_max_attempts_check"
  CHECK ("max_attempts" >= 1 AND "max_attempts" <= 10);

ALTER TABLE "auth_challenges"
  ADD CONSTRAINT "auth_challenges_resend_count_check"
  CHECK ("resend_count" >= 0);

-- Reset token selalu berpasangan dengan waktu kedaluwarsanya. Mencegah token
-- tanpa batas waktu bila ada jalur kode yang lupa mengisi salah satunya.
ALTER TABLE "auth_challenges"
  ADD CONSTRAINT "auth_challenges_reset_pair_check"
  CHECK (("reset_token_digest" IS NULL) = ("reset_expires_at" IS NULL));

-- ---------------------------------------------------------------------------
-- Perubahan kontak mencabut status verifikasi.
--
-- Ditegakkan lewat trigger, BUKAN di application service, karena pada baseline
-- ini belum ada satu pun jalur kode yang mengubah users.email atau users.phone
-- (belum ada endpoint edit profil). Menaruh invariant di database membuatnya
-- mustahil dilewati oleh endpoint yang dibuat kemudian, oleh admin console,
-- maupun oleh perbaikan data manual.
--
-- Perbandingan memakai IS DISTINCT FROM agar NULL tertangani dengan benar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tapgo_reset_contact_verification()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."phone" IS DISTINCT FROM OLD."phone" THEN
    NEW."phone_verified_at" := NULL;
  END IF;

  IF NEW."email" IS DISTINCT FROM OLD."email" THEN
    NEW."email_verified_at" := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_reset_contact_verification"
  BEFORE UPDATE OF "phone", "email" ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION tapgo_reset_contact_verification();
