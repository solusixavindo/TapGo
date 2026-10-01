-- CreateEnum
CREATE TYPE "RideSosAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "ride_sos_alerts" (
    "id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "ride_order_id" UUID,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "accuracy_meters" INTEGER,
    "status" "RideSosAlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_sos_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ride_sos_alerts_status_created_at_idx" ON "ride_sos_alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "ride_sos_alerts_driver_profile_id_created_at_idx" ON "ride_sos_alerts"("driver_profile_id", "created_at");

-- AddForeignKey
ALTER TABLE "ride_sos_alerts" ADD CONSTRAINT "ride_sos_alerts_driver_profile_id_fkey" FOREIGN KEY ("driver_profile_id") REFERENCES "ride_driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_sos_alerts" ADD CONSTRAINT "ride_sos_alerts_ride_order_id_fkey" FOREIGN KEY ("ride_order_id") REFERENCES "ride_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_sos_alerts" ADD CONSTRAINT "ride_sos_alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
