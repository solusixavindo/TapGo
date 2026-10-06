-- Bunyi peringatan pilihan driver per perangkat. Kolom baru dengan nilai bawaan
-- konstan: baris yang ada otomatis 'tapgo' (bunyi bawaan), tanpa menulis ulang tabel.
-- AlterTable
ALTER TABLE "push_tokens" ADD COLUMN "sound" VARCHAR(20) NOT NULL DEFAULT 'tapgo';
