-- Stage 5.2 — Ride domain foundation (ADDITIVE).
--
-- Hanya membuat objek baru untuk domain Ride Release 2:
-- enum Ride*, tabel ride_*, index, dan foreign key-nya.
--
-- TIDAK mengubah tabel/kolom lama, TIDAK ada DROP TABLE/DROP COLUMN/
-- TRUNCATE/DELETE, dan TIDAK menyentuh Business Engine membership.
-- Model legacy (rides, drivers, payments, dst.) tetap utuh sebagai
-- compatibility boundary read-only.

-- CreateEnum
CREATE TYPE "RideServiceType" AS ENUM ('MOTORCYCLE', 'CAR');

-- CreateEnum
CREATE TYPE "RideDriverStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RideDriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "RideVehicleVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RideOrderStatus" AS ENUM ('CREATED', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_TO_PICKUP', 'DRIVER_ARRIVED', 'IN_TRIP', 'COMPLETED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_SYSTEM', 'NO_DRIVER', 'EXPIRED', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "RidePaymentMethod" AS ENUM ('CASH', 'DIGITAL');

-- CreateEnum
CREATE TYPE "RidePaymentState" AS ENUM ('NOT_CONFIGURED', 'CASH_EXPECTED', 'CASH_REPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "RideEventType" AS ENUM ('QUOTE_CREATED', 'ORDER_CREATED', 'MATCHING_STARTED', 'DRIVER_ASSIGNED', 'DRIVER_REJECTED_OFFER', 'STATUS_CHANGED', 'CANCELLED', 'NO_DRIVER', 'EXPIRED', 'CASH_REPORTED', 'LOCATION_REJECTED');

-- CreateEnum
CREATE TYPE "RideActorRole" AS ENUM ('PASSENGER', 'DRIVER', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "RideCancellationReason" AS ENUM ('WAIT_TOO_LONG', 'DRIVER_NOT_MOVING', 'CHANGE_OF_PLAN', 'WRONG_PICKUP', 'FOUND_OTHER_TRANSPORT', 'PASSENGER_UNREACHABLE', 'VEHICLE_PROBLEM', 'SYSTEM_TIMEOUT', 'OTHER');

-- CreateTable
CREATE TABLE "ride_driver_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "RideDriverStatus" NOT NULL DEFAULT 'PENDING',
    "availability" "RideDriverAvailability" NOT NULL DEFAULT 'OFFLINE',
    "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ride_driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_vehicles" (
    "id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "type" "RideServiceType" NOT NULL,
    "plate_number_hash" VARCHAR(64) NOT NULL,
    "plate_number_masked" VARCHAR(32) NOT NULL,
    "brand" VARCHAR(60),
    "model" VARCHAR(60),
    "color" VARCHAR(30),
    "verification_status" "RideVehicleVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ride_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_quotes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "service_type" "RideServiceType" NOT NULL,
    "pickup_lat" DECIMAL(10,7) NOT NULL,
    "pickup_lng" DECIMAL(10,7) NOT NULL,
    "pickup_address" VARCHAR(255) NOT NULL,
    "dropoff_lat" DECIMAL(10,7) NOT NULL,
    "dropoff_lng" DECIMAL(10,7) NOT NULL,
    "dropoff_address" VARCHAR(255) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "eta_seconds" INTEGER NOT NULL,
    "base_fare" INTEGER NOT NULL,
    "distance_fare" INTEGER NOT NULL,
    "service_fee" INTEGER NOT NULL,
    "subtotal_fare" INTEGER NOT NULL,
    "total_fare" INTEGER NOT NULL,
    "fare_rule_version" VARCHAR(60) NOT NULL,
    "rounding_rule" VARCHAR(60) NOT NULL,
    "distance_source" VARCHAR(60) NOT NULL,
    "quote_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ride_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_orders" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(24) NOT NULL,
    "passenger_id" UUID NOT NULL,
    "driver_profile_id" UUID,
    "vehicle_id" UUID,
    "quote_id" UUID NOT NULL,
    "service_type" "RideServiceType" NOT NULL,
    "status" "RideOrderStatus" NOT NULL DEFAULT 'CREATED',
    "pickup_lat" DECIMAL(10,7) NOT NULL,
    "pickup_lng" DECIMAL(10,7) NOT NULL,
    "pickup_address" VARCHAR(255) NOT NULL,
    "dropoff_lat" DECIMAL(10,7) NOT NULL,
    "dropoff_lng" DECIMAL(10,7) NOT NULL,
    "dropoff_address" VARCHAR(255) NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "base_fare" INTEGER NOT NULL,
    "distance_fare" INTEGER NOT NULL,
    "service_fee" INTEGER NOT NULL,
    "subtotal_fare" INTEGER NOT NULL,
    "total_fare" INTEGER NOT NULL,
    "fare_rule_version" VARCHAR(60) NOT NULL,
    "payment_method" "RidePaymentMethod" NOT NULL DEFAULT 'CASH',
    "payment_state" "RidePaymentState" NOT NULL DEFAULT 'CASH_EXPECTED',
    "cancelled_by_user_id" UUID,
    "cancelled_by_role" "RideActorRole",
    "cancellation_reason" "RideCancellationReason",
    "cancellation_note" VARCHAR(500),
    "cancellation_fee" INTEGER,
    "cancellation_policy" VARCHAR(60),
    "cancelled_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ride_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_events" (
    "id" UUID NOT NULL,
    "ride_order_id" UUID NOT NULL,
    "type" "RideEventType" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "RideActorRole" NOT NULL,
    "previous_status" "RideOrderStatus",
    "new_status" "RideOrderStatus",
    "metadata" JSONB,
    "event_key" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_driver_locations" (
    "id" UUID NOT NULL,
    "driver_profile_id" UUID NOT NULL,
    "ride_order_id" UUID,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "accuracy_meters" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ride_driver_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_idempotency_records" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(60) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "user_id" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ride_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ride_driver_profiles_user_id_key" ON "ride_driver_profiles"("user_id");

-- CreateIndex
CREATE INDEX "ride_driver_profiles_status_availability_idx" ON "ride_driver_profiles"("status", "availability");

-- CreateIndex
CREATE INDEX "ride_vehicles_driver_profile_id_is_active_idx" ON "ride_vehicles"("driver_profile_id", "is_active");

-- CreateIndex
CREATE INDEX "ride_vehicles_type_verification_status_idx" ON "ride_vehicles"("type", "verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "ride_vehicles_driver_profile_id_plate_number_hash_key" ON "ride_vehicles"("driver_profile_id", "plate_number_hash");

-- CreateIndex
CREATE INDEX "ride_quotes_user_id_created_at_idx" ON "ride_quotes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_quotes_expires_at_idx" ON "ride_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ride_orders_public_reference_key" ON "ride_orders"("public_reference");

-- CreateIndex
CREATE UNIQUE INDEX "ride_orders_quote_id_key" ON "ride_orders"("quote_id");

-- CreateIndex
CREATE INDEX "ride_orders_passenger_id_created_at_idx" ON "ride_orders"("passenger_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_orders_driver_profile_id_created_at_idx" ON "ride_orders"("driver_profile_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_orders_status_service_type_idx" ON "ride_orders"("status", "service_type");

-- CreateIndex
CREATE UNIQUE INDEX "ride_events_event_key_key" ON "ride_events"("event_key");

-- CreateIndex
CREATE INDEX "ride_events_ride_order_id_created_at_idx" ON "ride_events"("ride_order_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_events_type_created_at_idx" ON "ride_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "ride_driver_locations_driver_profile_id_captured_at_idx" ON "ride_driver_locations"("driver_profile_id", "captured_at");

-- CreateIndex
CREATE INDEX "ride_driver_locations_ride_order_id_captured_at_idx" ON "ride_driver_locations"("ride_order_id", "captured_at");

-- CreateIndex
CREATE INDEX "ride_idempotency_records_created_at_idx" ON "ride_idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ride_idempotency_records_scope_user_id_idempotency_key_key" ON "ride_idempotency_records"("scope", "user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "ride_driver_profiles" ADD CONSTRAINT "ride_driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_vehicles" ADD CONSTRAINT "ride_vehicles_driver_profile_id_fkey" FOREIGN KEY ("driver_profile_id") REFERENCES "ride_driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_quotes" ADD CONSTRAINT "ride_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_orders" ADD CONSTRAINT "ride_orders_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_orders" ADD CONSTRAINT "ride_orders_driver_profile_id_fkey" FOREIGN KEY ("driver_profile_id") REFERENCES "ride_driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_orders" ADD CONSTRAINT "ride_orders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "ride_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_orders" ADD CONSTRAINT "ride_orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "ride_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_order_id_fkey" FOREIGN KEY ("ride_order_id") REFERENCES "ride_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_driver_locations" ADD CONSTRAINT "ride_driver_locations_driver_profile_id_fkey" FOREIGN KEY ("driver_profile_id") REFERENCES "ride_driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_driver_locations" ADD CONSTRAINT "ride_driver_locations_ride_order_id_fkey" FOREIGN KEY ("ride_order_id") REFERENCES "ride_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_idempotency_records" ADD CONSTRAINT "ride_idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
