-- Stage R2.1A — pencabutan sesi berbasis versi.
--
-- ADDITIVE ONLY. Satu kolom integer NOT NULL DEFAULT 0 pada "users".
-- Nol tabel finansial disentuh, nol kolom di-drop, nol data diubah.
--
-- DEFAULT 0 dipilih dengan sengaja: seluruh akun yang sudah ada dianggap
-- berada pada versi awal, sehingga token lama yang belum membawa claim versi
-- tetap diterima sampai akun tersebut mengalami pencabutan pertamanya.
-- Tanpa itu, penerapan migration akan mengeluarkan seluruh pengguna aktif
-- dari aplikasi secara serentak.
--
-- Statement `ALTER COLUMN "id" DROP DEFAULT` untuk tabel lama yang dihasilkan
-- `prisma migrate diff` sengaja tidak disertakan: itu drift pre-existing.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_version" INTEGER NOT NULL DEFAULT 0;

-- Versi otorisasi tidak boleh mundur atau negatif.
ALTER TABLE "users"
  ADD CONSTRAINT "users_auth_version_check"
  CHECK ("auth_version" >= 0);
