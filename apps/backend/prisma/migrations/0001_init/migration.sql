CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE "UserRole" AS ENUM ('USER', 'DRIVER', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'DELETED');
CREATE TYPE "DriverStatus" AS ENUM ('OFFLINE', 'AVAILABLE', 'ON_TRIP', 'SUSPENDED');
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "RideStatus" AS ENUM ('REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'WALLET', 'MIDTRANS');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');
CREATE TYPE "WalletTransactionType" AS ENUM ('TOPUP', 'PAYMENT', 'REFUND', 'WITHDRAWAL', 'COMMISSION', 'ADJUSTMENT');
CREATE TYPE "ChatSenderType" AS ENUM ('USER', 'DRIVER', 'ADMIN');

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "fullName" VARCHAR(120) NOT NULL,
  "email" VARCHAR(180) UNIQUE,
  "phone" VARCHAR(32) NOT NULL UNIQUE,
  "password_hash" TEXT,
  "avatar_url" TEXT,
  "referral_code" VARCHAR(24) NOT NULL UNIQUE,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "sessions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "refresh_token_hash" TEXT NOT NULL,
  "user_agent" TEXT,
  "ip_address" INET,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "otp_challenges" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "phone" VARCHAR(32) NOT NULL,
  "code_hash" TEXT NOT NULL,
  "purpose" VARCHAR(40) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "drivers" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
  "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
  "license_number" VARCHAR(80) UNIQUE,
  "vehicle_type" VARCHAR(40) NOT NULL DEFAULT 'BIKE',
  "vehicle_plate" VARCHAR(24),
  "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
  "rating_count" INTEGER NOT NULL DEFAULT 0,
  "current_lat" DECIMAL(10,7),
  "current_lng" DECIMAL(10,7),
  "last_location_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "driver_documents" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "driver_id" UUID NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "type" VARCHAR(60) NOT NULL,
  "url" TEXT NOT NULL,
  "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "rides" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "customer_id" UUID NOT NULL REFERENCES "users"("id"),
  "driver_id" UUID REFERENCES "drivers"("id"),
  "status" "RideStatus" NOT NULL DEFAULT 'REQUESTED',
  "service_type" VARCHAR(40) NOT NULL,
  "pickup_address" TEXT NOT NULL,
  "pickup_lat" DECIMAL(10,7) NOT NULL,
  "pickup_lng" DECIMAL(10,7) NOT NULL,
  "destination_address" TEXT NOT NULL,
  "destination_lat" DECIMAL(10,7) NOT NULL,
  "destination_lng" DECIMAL(10,7) NOT NULL,
  "distance_km" DECIMAL(8,2) NOT NULL,
  "estimated_fare" DECIMAL(12,2) NOT NULL,
  "final_fare" DECIMAL(12,2),
  "promo_code" VARCHAR(40),
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "cancellation_reason" TEXT
);

CREATE TABLE "ride_status_events" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "ride_id" UUID NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "status" "RideStatus" NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "payments" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "ride_id" UUID NOT NULL UNIQUE REFERENCES "rides"("id"),
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(12,2) NOT NULL,
  "provider" VARCHAR(40),
  "provider_reference" VARCHAR(120),
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "wallets" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'IDR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "wallet_transactions" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "wallet_id" UUID NOT NULL REFERENCES "wallets"("id") ON DELETE CASCADE,
  "type" "WalletTransactionType" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reference_type" VARCHAR(60),
  "reference_id" VARCHAR(80),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "promo_codes" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "code" VARCHAR(40) NOT NULL UNIQUE,
  "description" TEXT NOT NULL,
  "discount_type" VARCHAR(20) NOT NULL,
  "discount_value" DECIMAL(12,2) NOT NULL,
  "max_discount" DECIMAL(12,2),
  "min_spend" DECIMAL(12,2),
  "quota" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "chat_messages" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "ride_id" UUID NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "sender_id" UUID NOT NULL,
  "sender_type" "ChatSenderType" NOT NULL,
  "message" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "reviews" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "ride_id" UUID NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  "reviewer_id" UUID NOT NULL REFERENCES "users"("id"),
  "driver_id" UUID,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "push_tokens" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" VARCHAR(20) NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "device_id" VARCHAR(120),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "driver_earnings" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "driver_id" UUID NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "ride_id" UUID,
  "gross_amount" DECIMAL(12,2) NOT NULL,
  "commission" DECIMAL(12,2) NOT NULL,
  "net_amount" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "withdrawal_requests" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "driver_id" UUID NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "bank_account" JSONB NOT NULL,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "audit_logs" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "actor_id" UUID REFERENCES "users"("id"),
  "action" VARCHAR(120) NOT NULL,
  "entity_type" VARCHAR(80) NOT NULL,
  "entity_id" VARCHAR(80),
  "metadata" JSONB,
  "ip_address" INET,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "otp_challenges_phone_purpose_expires_at_idx" ON "otp_challenges"("phone", "purpose", "expires_at");
CREATE INDEX "drivers_status_vehicle_type_idx" ON "drivers"("status", "vehicle_type");
CREATE INDEX "drivers_current_lat_current_lng_idx" ON "drivers"("current_lat", "current_lng");
CREATE INDEX "driver_documents_driver_id_type_idx" ON "driver_documents"("driver_id", "type");
CREATE INDEX "rides_customer_id_requested_at_idx" ON "rides"("customer_id", "requested_at");
CREATE INDEX "rides_driver_id_requested_at_idx" ON "rides"("driver_id", "requested_at");
CREATE INDEX "rides_status_service_type_idx" ON "rides"("status", "service_type");
CREATE INDEX "rides_pickup_lat_pickup_lng_idx" ON "rides"("pickup_lat", "pickup_lng");
CREATE INDEX "ride_status_events_ride_id_created_at_idx" ON "ride_status_events"("ride_id", "created_at");
CREATE INDEX "payments_status_method_idx" ON "payments"("status", "method");
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at");
CREATE INDEX "promo_codes_code_is_active_idx" ON "promo_codes"("code", "is_active");
CREATE INDEX "chat_messages_ride_id_created_at_idx" ON "chat_messages"("ride_id", "created_at");
CREATE INDEX "reviews_ride_id_idx" ON "reviews"("ride_id");
CREATE INDEX "reviews_driver_id_idx" ON "reviews"("driver_id");
CREATE INDEX "push_tokens_user_id_platform_idx" ON "push_tokens"("user_id", "platform");
CREATE INDEX "driver_earnings_driver_id_created_at_idx" ON "driver_earnings"("driver_id", "created_at");
CREATE INDEX "withdrawal_requests_driver_id_status_idx" ON "withdrawal_requests"("driver_id", "status");
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
