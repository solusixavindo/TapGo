-- CreateEnum
CREATE TYPE "DriverFaceCheckStatus" AS ENUM ('PENDING', 'PASSED', 'BLOCKED');

-- CreateTable
CREATE TABLE "driver_face_references" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "embedding_cipher_text" BYTEA NOT NULL,
    "embedding_cipher_iv" BYTEA NOT NULL,
    "embedding_cipher_tag" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "model_version" VARCHAR(40) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_face_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_face_checks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_date" DATE NOT NULL,
    "status" "DriverFaceCheckStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "similarity_score" DECIMAL(5,4),
    "model_version" VARCHAR(40),
    "last_attempt_at" TIMESTAMP(3),
    "passed_at" TIMESTAMP(3),
    "blocked_at" TIMESTAMP(3),
    "admin_override_by_id" UUID,
    "admin_override_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_face_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_face_references_user_id_key" ON "driver_face_references"("user_id");

-- CreateIndex
CREATE INDEX "driver_face_checks_user_id_check_date_idx" ON "driver_face_checks"("user_id", "check_date");

-- CreateIndex
CREATE UNIQUE INDEX "driver_face_checks_user_id_check_date_key" ON "driver_face_checks"("user_id", "check_date");

-- AddForeignKey
ALTER TABLE "driver_face_references" ADD CONSTRAINT "driver_face_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_face_checks" ADD CONSTRAINT "driver_face_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_face_checks" ADD CONSTRAINT "driver_face_checks_admin_override_by_id_fkey" FOREIGN KEY ("admin_override_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
