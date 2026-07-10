# PostgreSQL Database Design

## Core Tables

- `users`: single identity table for customers, drivers, admins, and super admins.
- `sessions`: refresh-token session store with revocation and rotation support.
- `otp_challenges`: OTP request records with attempt tracking.
- `drivers`: driver profile, KYC status, online status, current location, and ratings.
- `driver_documents`: Cloudinary-backed KYC document metadata.
- `rides`: booking lifecycle, pickup/destination coordinates, fare estimates, assignment, and cancellation.
- `ride_status_events`: immutable ride state history for realtime replay and audit.
- `payments`: ride payment state and provider reference.
- `wallets`, `wallet_transactions`: ledger-oriented wallet model.
- `promo_codes`: promotion configuration for admin-managed campaigns.
- `chat_messages`: ride-scoped user/driver/admin chat.
- `reviews`: ratings and comments after rides.
- `push_tokens`: Firebase device tokens.
- `driver_earnings`, `withdrawal_requests`: driver finance operations.
- `audit_logs`: operational and admin activity trace.

## Indexing Strategy

- Role/status indexes for account management.
- Driver status and vehicle type indexes for matching.
- Coordinate indexes on driver and ride locations as a baseline. For high scale, add PostGIS `geography(Point, 4326)` columns and GiST indexes.
- Ride status/service indexes for dispatch and admin monitoring.
- Wallet and earning indexes by owner plus creation time for financial reports.

## Migration Files

- Prisma schema: `apps/backend/prisma/schema.prisma`
- Initial SQL migration: `apps/backend/prisma/migrations/0001_init/migration.sql`
- Seeder: `apps/backend/prisma/seed.ts`
