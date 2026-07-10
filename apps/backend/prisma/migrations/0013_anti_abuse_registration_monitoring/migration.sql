-- Phase 2 anti-abuse monitoring.
-- Adds read/report-friendly registration event logs and abuse flags.
-- This migration is additive only and does not modify existing wallet,
-- referral, membership, commission, payment, or production business data.

CREATE TYPE "AbuseFlagStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "AbuseFlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "registration_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "normalized_phone" VARCHAR(32) NOT NULL,
  "phone_hash" VARCHAR(64) NOT NULL,
  "device_fingerprint_hash" VARCHAR(64),
  "ip_address" INET,
  "user_agent" VARCHAR(500),
  "referral_code_used" VARCHAR(24),
  "suspicious" BOOLEAN NOT NULL DEFAULT false,
  "suspicious_reasons" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "registration_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "abuse_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "registration_event_id" UUID,
  "flag_type" VARCHAR(80) NOT NULL,
  "severity" "AbuseFlagSeverity" NOT NULL DEFAULT 'LOW',
  "status" "AbuseFlagStatus" NOT NULL DEFAULT 'OPEN',
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "abuse_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "registration_events_user_id_created_at_idx" ON "registration_events"("user_id", "created_at");
CREATE INDEX "registration_events_normalized_phone_created_at_idx" ON "registration_events"("normalized_phone", "created_at");
CREATE INDEX "registration_events_phone_hash_created_at_idx" ON "registration_events"("phone_hash", "created_at");
CREATE INDEX "registration_events_device_fingerprint_hash_created_at_idx" ON "registration_events"("device_fingerprint_hash", "created_at");
CREATE INDEX "registration_events_ip_address_created_at_idx" ON "registration_events"("ip_address", "created_at");
CREATE INDEX "registration_events_referral_code_used_created_at_idx" ON "registration_events"("referral_code_used", "created_at");
CREATE INDEX "registration_events_suspicious_created_at_idx" ON "registration_events"("suspicious", "created_at");

CREATE INDEX "abuse_flags_user_id_status_idx" ON "abuse_flags"("user_id", "status");
CREATE INDEX "abuse_flags_registration_event_id_idx" ON "abuse_flags"("registration_event_id");
CREATE INDEX "abuse_flags_flag_type_status_idx" ON "abuse_flags"("flag_type", "status");
CREATE INDEX "abuse_flags_severity_status_idx" ON "abuse_flags"("severity", "status");
CREATE INDEX "abuse_flags_created_at_idx" ON "abuse_flags"("created_at");

ALTER TABLE "registration_events"
  ADD CONSTRAINT "registration_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "abuse_flags"
  ADD CONSTRAINT "abuse_flags_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "abuse_flags"
  ADD CONSTRAINT "abuse_flags_registration_event_id_fkey"
  FOREIGN KEY ("registration_event_id") REFERENCES "registration_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
