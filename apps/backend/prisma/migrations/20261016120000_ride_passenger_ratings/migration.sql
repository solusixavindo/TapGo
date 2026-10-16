-- Penilaian driver terhadap penumpang per order selesai. Tabel baru, tanpa mengubah tabel yang ada.
-- CreateTable
CREATE TABLE "ride_passenger_ratings" (
    "id" UUID NOT NULL,
    "ride_order_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "stars" SMALLINT NOT NULL,
    "note" VARCHAR(280),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_passenger_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ride_passenger_ratings_ride_order_id_key" ON "ride_passenger_ratings"("ride_order_id");

-- CreateIndex
CREATE INDEX "ride_passenger_ratings_passenger_id_idx" ON "ride_passenger_ratings"("passenger_id");

-- AddForeignKey
ALTER TABLE "ride_passenger_ratings" ADD CONSTRAINT "ride_passenger_ratings_ride_order_id_fkey" FOREIGN KEY ("ride_order_id") REFERENCES "ride_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bintang hanya 1..5 (dijaga juga di database, bukan hanya di validator).
ALTER TABLE "ride_passenger_ratings" ADD CONSTRAINT "ride_passenger_ratings_stars_range" CHECK ("stars" BETWEEN 1 AND 5);
