-- Penyimpanan sementara dokumen identitas di database (Stage R2.6 jalur A).
--
-- Keputusan Owner: berkas disimpan maksimal 24 jam, lalu admin mencetaknya
-- sebagai berkas administrasi dan isinya dihapus dari database.
--
-- Isi berkas disimpan sebagai ciphertext AES-256-GCM. Kuncinya berada di
-- environment sehingga salinan backup database saja tidak cukup membukanya.
-- Seluruh kolom nullable: baris dokumen tetap bertahan setelah isinya dihapus.
ALTER TABLE "membership_documents" ADD COLUMN "cipher_text" BYTEA;
ALTER TABLE "membership_documents" ADD COLUMN "cipher_iv" BYTEA;
ALTER TABLE "membership_documents" ADD COLUMN "cipher_tag" BYTEA;
ALTER TABLE "membership_documents" ADD COLUMN "key_version" INTEGER;
ALTER TABLE "membership_documents" ADD COLUMN "content_type" VARCHAR(40);
ALTER TABLE "membership_documents" ADD COLUMN "size_bytes" INTEGER;
ALTER TABLE "membership_documents" ADD COLUMN "checksum" VARCHAR(64);
ALTER TABLE "membership_documents" ADD COLUMN "uploaded_at" TIMESTAMP(3);
ALTER TABLE "membership_documents" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "membership_documents" ADD COLUMN "purged_at" TIMESTAMP(3);

-- Dipakai penyapu berkala untuk menemukan dokumen yang sudah lewat masa simpan.
CREATE INDEX "membership_documents_expires_at_idx" ON "membership_documents"("expires_at");
