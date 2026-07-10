# Google Play Release Checklist TapGo

Target package name: `id.tapgo.membership`

## Production Guard

- [ ] `NODE_ENV=production` set on backend production server.
- [ ] Development payment simulator endpoint returns `PAYMENT_SIMULATOR_DISABLED`.
- [ ] `MIDTRANS_SERVER_KEY` configured.
- [ ] Midtrans notification must include valid `signature_key`.
- [ ] `MIDTRANS_IS_PRODUCTION=true` only after sandbox UAT is approved.

## Android Identity

- [x] Android `applicationId` set to `id.tapgo.membership`.
- [x] Android namespace set to `id.tapgo.membership`.
- [x] Android app label set to `TapGo`.
- [ ] Launcher icon verified against official TapGo logo.
- [ ] Adaptive icon prepared for Play Store.

## Signing

- [x] Release signing config prepared without committing real key.
- [ ] Create upload keystore.
- [ ] Copy `apps/user_app/android/key.properties.example` to `apps/user_app/android/key.properties`.
- [ ] Fill local absolute `storeFile`, `storePassword`, `keyPassword`, and `keyAlias`.
- [ ] Run `flutter build appbundle --release`.
- [ ] Store keystore securely outside repository.

## Legal and Store Listing

- [x] Privacy Policy template created.
- [x] Terms and Conditions template created.
- [ ] Legal review completed.
- [ ] Public Privacy Policy URL published.
- [ ] Public Terms URL published.
- [ ] Play Console Data Safety completed.
- [ ] App category and content rating completed.
- [ ] Screenshots and short/long descriptions prepared.

## Permissions

- [ ] Camera permission disclosed for QR scan and document/selfie capture.
- [ ] Photo/media permission disclosed for KTP/selfie upload.
- [ ] Notification permission disclosed if push notifications are enabled.

## Backend

- [ ] Production database migration applied.
- [ ] Production seed excludes demo data.
- [ ] Admin seed run only for approved admin accounts.
- [ ] Full integration tests pass with `TAPGO_TEST_DATABASE_URL`.
- [ ] Monitoring/logging configured.
- [ ] Backup and restore plan documented.

## Flutter

- [ ] Demo fallback disabled for production flavor.
- [ ] Backend logout called before local session clear.
- [ ] Production API base URL configured.
- [ ] Release AAB tested on internal testing track.

## Final Gate

- [ ] Backend build passes.
- [ ] Backend tests pass.
- [ ] Flutter analyze passes.
- [ ] Flutter tests pass.
- [ ] Release appbundle builds with release signing.
- [ ] Internal testing approval completed.
