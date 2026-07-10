# TapGo Membership System

## Membership Tiers

- `SILVER`: entry tier, lower direct bonus and fewer active referral levels.
- `GOLD`: mid tier, higher direct bonus and more active levels.
- `PLATINUM`: top tier, maximum referral depth up to 10 levels.

## Backend APIs

All routes require JWT authentication:

- `GET /api/v1/memberships/plans`
- `GET /api/v1/memberships/me`
- `POST /api/v1/memberships/upgrade`
- `PUT /api/v1/memberships/admin/plans/:tier`

Admin update route requires `ADMIN` or `SUPER_ADMIN`.

## Upgrade Flow

1. Load current user membership.
2. Load target tier.
3. Reject inactive tier, same-tier updates, and downgrade attempts.
4. Update `users.membership_id`.
5. Write zero-amount `wallet_transactions` row with `MEMBERSHIP_UPGRADE` reference for payment traceability.
6. Write `audit_logs` row with target tier and payment reference.

The update runs in a Prisma transaction with `Serializable` isolation.

## Commission Rules

The referral commission engine reads:

- `memberships.direct_bonus`
- `memberships.active_levels`
- `membership_benefits.level`
- `membership_benefits.commission_rate`
- `membership_benefits.fixed_bonus`

Admin rule updates are applied with upsert semantics per benefit level, so changing one tier does not disturb other tiers.
