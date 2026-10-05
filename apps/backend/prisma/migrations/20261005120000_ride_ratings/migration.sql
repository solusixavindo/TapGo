-- Penilaian penumpang per order selesai. Tabel baru, tanpa mengubah tabel yang ada.
-- CreateTable
CREATE TABLE "ride_ratings" (
    "id" UUID NOT NULL,
    "ride_order_id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "stars" SMALLINT NOT NULL,
    "note" VARCHAR(280),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ride_ratings_ride_order_id_key" ON "ride_ratings"("ride_order_id");

-- CreateIndex
CREATE INDEX "ride_ratings_driver_profile_id_idx" ON "ride_ratings"("driver_profile_id");

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_ride_order_id_fkey" FOREIGN KEY ("ride_order_id") REFERENCES "ride_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_driver_profile_id_fkey" FOREIGN KEY ("driver_profile_id") REFERENCES "ride_driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bintang hanya 1..5 (dijaga juga di database, bukan hanya di validator).
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
