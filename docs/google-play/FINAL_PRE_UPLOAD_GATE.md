# Final Pre-Upload Gate - Google Play Internal Testing

Tanggal: 15 Juli 2026  
Branch: `release/google-play-readiness`  
Version: `1.0.3+4`

## Final Decision

**GO FOR INTERNAL TESTING UPLOAD**

Dengan catatan manual:

1. Upload hanya ke Internal Testing/Closed Testing, bukan Production.
2. Pastikan Play Console App Content/Data Safety diisi sesuai dokumen `docs/google-play/`.
3. Pastikan URL publik legal sudah live setelah website di-deploy.
4. Jangan commit/upload keystore, `key.properties`, atau AAB ke Git.

## Gate Status

| Gate | Status | Bukti / Catatan |
|---|---:|---|
| Branch release benar | PASS | `release/google-play-readiness`. |
| Package ID final | PASS | `id.tapgolion.tapgo`. |
| Version | PASS | `1.0.3+4`; setelah AAB ini diupload, build berikutnya wajib `versionCode=5`. |
| compile/target/min SDK | PASS | `compileSdk=36`, `targetSdk=35`, `minSdk=24` via Flutter default. |
| Release signing | PASS | Build release sukses; `jarsigner` result: `jar verified`; release signing fail-closed jika `key.properties` tidak ada. |
| AAB build | PASS | `apps/user_app/build/app/outputs/bundle/release/app-release.aab`. |
| AAB size | PASS | 55.1 MB / 53 MB shown by filesystem. |
| 64-bit support | PASS | Bundle contains `arm64-v8a`; also includes `armeabi-v7a` and `x86_64`. |
| Production API URL | PASS | Default API base points to `https://api.tapgolion.id/api/v1`. |
| No localhost/tunnel marker | PASS | AAB scan found no `localhost`, `127.0.0.1`, `10.0.2.2`, `ngrok`, or `trycloudflare`. |
| No payment secret marker | PASS | AAB scan found no `DOKU_SECRET`, `DOKU_API_KEY`, `MIDTRANS_SERVER_KEY`, `JWT_SECRET`, `DATABASE_URL`, or `serverKey`. |
| Debug banner | PASS | `debugShowCheckedModeBanner: false`. |
| Simulator production safety | PASS | `TAPGO_APP_MODE` default is `production`; payment simulator only runs in development/staging or widget-test override. |
| Account deletion in app | PASS | `Akun -> Hapus Akun` and settings shortcut available. |
| Account deletion confirmation | PASS | Dialog `Konfirmasi hapus akun` shown before submit. |
| Account deletion backend | PASS | Authenticated `POST /api/v1/account/delete-request`; existing pending request is reused. |
| Account deletion is not logout-only | PASS | Request is persisted through backend `accountDeletionRequest`. |
| Retention/anonymization docs | PASS | `ACCOUNT_DELETION_COMPLIANCE.md`, privacy policy, legal endpoint explain retained transaction/legal data. |
| Account deletion test | PASS | Widget test covers menu, dialog, cancel path, and no immediate success without confirmation. |
| Public delete URL source | PASS | `apps/landing-page/src/app/delete-account/page.tsx`; alias `hapus-akun` juga tersedia di source. |
| Public delete URL live | PASS | Live URL: `https://tapgolion.id/delete-account`. |
| Privacy Policy URL source | PASS | `apps/landing-page/src/app/privacy-policy/page.tsx`. |
| Terms URL source | PASS | `apps/landing-page/src/app/terms-and-conditions/page.tsx`. |
| Refund Policy URL source | PASS | `apps/landing-page/src/app/refund-policy/page.tsx`. |
| Contact URL source | PASS | `apps/landing-page/src/app/contact/page.tsx`. |
| Reviewer account password | MANUAL ACTION REQUIRED | Do not store in repo. Provide only in Play Console App Access. |
| No production data/credential created | PASS | No reviewer credential or production data was created by this task. |

## Compliance URLs

| Purpose | Final URL | Source Route Status | Deployment Status |
|---|---|---:|---:|
| Privacy Policy | `https://tapgolion.id/privacy-policy` | PASS | MANUAL VERIFY LIVE |
| Terms & Conditions | `https://tapgolion.id/terms-and-conditions` | PASS | MANUAL VERIFY LIVE |
| Refund Policy | `https://tapgolion.id/refund-policy` | PASS | MANUAL VERIFY LIVE |
| Account Deletion | `https://tapgolion.id/delete-account` | PASS | VERIFIED LIVE |
| Contact/Support | `https://tapgolion.id/contact` | PASS | MANUAL VERIFY LIVE |

## Reviewer Account Flow

Reviewer account identifier: `playreview@tapgolion.id`

Status:

- Password is not hardcoded.
- Password must be entered only in Play Console App Access notes or a secure owner vault.
- Current login flow is phone/password based; if reviewer email is used as identifier, owner must ensure backend account accepts the documented credential path or provide a reviewer phone account in Play Console notes.
- No OTP-only personal-device dependency was found in the Flutter login source.

## AAB Checksum

File:

`apps/user_app/build/app/outputs/bundle/release/app-release.aab`

SHA-256:

`1684d0b1beb584e502633f61b5265c7f1469954da8fe0d4f4cca8d019f285a4a`

Signature note:

- `jarsigner -verify` result: `jar verified`.
- Warning self-signed certificate is expected for an Android upload key and is not a Play Console blocker when the app is uploaded through Google Play App Signing.

## Validation Results

| Command | Status |
|---|---:|
| `flutter clean` | PASS |
| `flutter pub get` | PASS |
| `flutter analyze` | PASS |
| `flutter test` | PASS |
| `flutter build appbundle --release` | PASS |
| AAB SHA-256 | PASS |
| AAB string scan | PASS: no localhost/tunnel/secret/test credential markers found |
| `jarsigner -verify` | PASS: `jar verified` |

## Remaining Manual Actions

1. Optional: deploy landing page alias so `https://tapgolion.id/hapus-akun` is also live.
2. Verify all public compliance URLs from a non-authenticated browser.
3. Add reviewer access credentials in Play Console only.
4. Upload AAB to Internal Testing.
5. After this AAB is uploaded, increment the next build to `versionCode=5`.
