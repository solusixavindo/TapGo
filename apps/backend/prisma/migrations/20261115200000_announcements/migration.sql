-- Pengumuman pemilik di ikon bel aplikasi. Aditif: dua tabel baru, tidak menyentuh tabel yang ada.
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "audience" VARCHAR(10) NOT NULL DEFAULT 'USERS',
    "created_by" UUID NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "archived_by" UUID,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "announcement_seen" (
    "user_id" UUID NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_seen_pkey" PRIMARY KEY ("user_id")
);

CREATE INDEX "announcements_published_at_idx" ON "announcements"("published_at");
CREATE INDEX "announcements_created_by_published_at_idx" ON "announcements"("created_by", "published_at");

ALTER TABLE "announcement_seen" ADD CONSTRAINT "announcement_seen_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
