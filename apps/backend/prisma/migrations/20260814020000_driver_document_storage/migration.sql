-- Penyimpanan sementara dokumen driver di database.
--
-- Keputusan Owner: kebijakan 24 jam yang berlaku untuk dokumen membership
-- diberlakukan juga untuk dokumen driver. Berkas disimpan maksimal 24 jam,
-- lalu admin mencetaknya sebagai berkas administrasi dan isinya dihapus.
--
-- Isi berkas disimpan sebagai ciphertext AES-256-GCM. Kuncinya berada di
-- environment, dan diturunkan lewat label domain "tapgo.driver.document.v1"
-- yang BERBEDA dari label dokumen membership — kebocoran satu domain tidak
-- membuka domain lain.
--
-- Seluruh kolom nullable: baris dokumen sengaja tetap bertahan setelah isinya
-- dihapus, karena status, checksum, dan jejak waktunya masih dibutuhkan untuk
-- membuktikan dokumen pernah ada dan sudah dimusnahkan tepat waktu.
ALTER TABLE "driver_documents" ADD COLUMN "cipher_text" BYTEA;
ALTER TABLE "driver_documents" ADD COLUMN "cipher_iv" BYTEA;
ALTER TABLE "driver_documents" ADD COLUMN "cipher_tag" BYTEA;
ALTER TABLE "driver_documents" ADD COLUMN "key_version" INTEGER;
ALTER TABLE "driver_documents" ADD COLUMN "content_type" VARCHAR(40);
ALTER TABLE "driver_documents" ADD COLUMN "size_bytes" INTEGER;
ALTER TABLE "driver_documents" ADD COLUMN "checksum" VARCHAR(64);
ALTER TABLE "driver_documents" ADD COLUMN "uploaded_at" TIMESTAMP(3);
ALTER TABLE "driver_documents" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "driver_documents" ADD COLUMN "purged_at" TIMESTAMP(3);
-- DEFAULT diperlukan karena kolomnya NOT NULL sedangkan barisnya mungkin sudah
-- ada. PostgreSQL 11 ke atas menuliskan default ini di katalog, bukan menulis
-- ulang seluruh tabel, jadi aman untuk tabel besar sekalipun.
ALTER TABLE "driver_documents"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Kolom url dibuat opsional. Sebelumnya NOT NULL karena dirancang menunjuk
-- penyimpanan berkas eksternal, sedangkan isi dokumen kini berada di kolom
-- ciphertext. Melonggarkan batasan aman: baris lama yang sudah punya nilai
-- tidak tersentuh.
ALTER TABLE "driver_documents" ALTER COLUMN "url" DROP NOT NULL;

-- Satu dokumen per jenis untuk tiap driver. Unggah ulang menimpa yang lama,
-- bukan menumpuk salinan KTP yang sama di database.
--
-- PERINGATAN OPERASIONAL: pembuatan indeks ini GAGAL bila sudah ada dua baris
-- dengan driver_id dan type yang sama. Tabel ini belum pernah disentuh kode
-- mana pun sehingga semestinya kosong, tetapi periksalah lebih dulu sebelum
-- menjalankan migrasi di produksi:
--
--   SELECT driver_id, type, COUNT(*) FROM driver_documents
--   GROUP BY driver_id, type HAVING COUNT(*) > 1;
--
-- Kegagalan yang berisik jauh lebih baik daripada duplikat yang dibersihkan
-- diam-diam: yang dihapus adalah dokumen identitas orang.
CREATE UNIQUE INDEX "driver_documents_driver_id_type_key"
  ON "driver_documents"("driver_id", "type");

-- Indeks non-unik lama pada kolom yang sama menjadi mubazir: indeks unik di
-- atas sudah melayani pencarian yang sama sekaligus menegakkan batasannya.
-- Membiarkannya hanya menambah beban tulis tanpa memberi manfaat apa pun.
DROP INDEX IF EXISTS "driver_documents_driver_id_type_idx";

-- Dipakai penyapu berkala untuk menemukan dokumen yang sudah lewat masa simpan.
CREATE INDEX "driver_documents_expires_at_idx" ON "driver_documents"("expires_at");
