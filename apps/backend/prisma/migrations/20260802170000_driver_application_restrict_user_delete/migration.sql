-- Stage 5.14B follow-up — histori pengajuan driver bertahan melewati
-- penghapusan User (Owner Review: ON DELETE CASCADE REJECTED).
--
-- Migration ini KOREKTIF dan bercakupan tunggal: satu-satunya objek yang
-- disentuh adalah foreign key ride_driver_applications_user_id_fkey.
-- Enum, partial unique index, seluruh CHECK constraint, kolom, dan index
-- lain TIDAK diubah. Tidak ada tabel legacy atau finansial yang disentuh.
--
-- Alasan RESTRICT:
--   - penghapusan akun tidak boleh menghapus histori pengajuan
--   - keputusan retention / legal hold tetap fail-closed
--   - application record tidak boleh hilang diam-diam
--   - mencegah cascade merambat ke histori KYC/audit di masa depan
--
-- Konsekuensi yang disengaja: hard-delete User yang masih memiliki
-- application akan ditolak PostgreSQL. Penghapusan akun di TapGo berupa
-- AccountDeletionRequest, bukan hard delete; tidak ada satu pun
-- `user.delete` pada source produksi, sehingga tidak ada alur produksi
-- yang terpengaruh.
--
-- Kedua statement di bawah dihasilkan oleh `prisma migrate diff`, bukan
-- ditulis tangan. DROP lalu ADD adalah satu-satunya cara PostgreSQL
-- mengubah aksi referensial sebuah foreign key.

-- DropForeignKey
ALTER TABLE "ride_driver_applications" DROP CONSTRAINT "ride_driver_applications_user_id_fkey";

-- AddForeignKey
ALTER TABLE "ride_driver_applications" ADD CONSTRAINT "ride_driver_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
