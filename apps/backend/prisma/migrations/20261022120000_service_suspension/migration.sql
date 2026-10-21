-- Status penghentian layanan: satu baris global, diubah hanya oleh SUPER_ADMIN_VIP lewat API.
CREATE TABLE "service_suspension" (
    "id" VARCHAR(16) NOT NULL,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "message" VARCHAR(300),
    "changed_by_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_suspension_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_suspension_single_row" CHECK ("id" = 'GLOBAL')
);

-- Baris awal: layanan berjalan normal.
INSERT INTO "service_suspension" ("id", "suspended") VALUES ('GLOBAL', false);
