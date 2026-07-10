# Changelog

All notable changes to TapGo are documented in this file.

This project follows the Keep a Changelog format and uses Semantic Versioning with pre-release labels for launch milestones.

## [1.0.0-alpha] - 2026-07-11

### Added
- Membership Basic, Silver, Gold, Platinum
- Referral and level bonus engine
- Wallet and transaction ledger
- Admin and Super Admin console
- Founder Platinum Program
- Founder Platinum admin experience
- DOKU Checkout integration
- DOKU webhook validation and idempotency
- Midtrans fallback flow
- Production readiness documentation
- Google Play release assets and preparation
- GitHub repository and release workflow

### Changed
- DOKU set as primary payment gateway
- Xendit removed from TapGo v1.0 scope
- Workspace and documentation structure cleaned up

### Security
- Server-side payment validation
- Webhook signature verification
- Sensitive environment variables excluded from Git
- Payment processing idempotency
- Founder Platinum limit and audit controls

### Known Limitations
- DOKU production webhook UAT belum dibuktikan dengan transaksi nyata
- Google Play production belum dipublikasikan
- Midtrans masih dalam proses review
