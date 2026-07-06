# Google Play Final Release Checklist

Status: final checklist only. Jangan build AAB dan jangan upload Google Play dari dokumen ini.

## Release Gate

Google Play final release boleh lanjut hanya setelah DOKU production webhook UAT PASS dan owner menyetujui final release build.

## Checklist

| Area | Required | Status | Owner Action |
| --- | --- | --- | --- |
| Package name | `id.tapgolion.tapgo` | Prepared, verify in final AAB | Required before upload |
| Version code/name | Higher than previous Play release | Pending final build | Required |
| Release keystore | Release signing, no debug fallback | Prepared from prior hardening | Verify key.properties locally |
| AAB readiness | Build after payment stable | Pending | Do not build yet |
| App icon | Official TapGo icon | Prepared | Verify in Play Console preview |
| Feature graphic | 1024 x 500, brand-safe | Prepared | Verify no cropping |
| Screenshots | User-facing, no sensitive data | Prepared/needs final review | Upload final set |
| Privacy Policy | Public URL active | Prepared | Verify URL live |
| Terms | Public URL active | Prepared | Verify URL live |
| Data Safety | User data, camera/media, payment, account deletion declared | Draft prepared | Final owner submission |
| App access | Reviewer/test account valid | Pending owner action | Provide credentials in Play Console only |
| Content rating | Questionnaire completed | Pending owner action | Submit in Play Console |
| Account deletion | URL/instruction available | Prepared, verify | Confirm URL |
| Support email | `support@tapgolion.id` | Required | Verify inbox active |
| Website | `https://tapgolion.id` | Required | Verify live |
| Internal testing | Smoke test and install test | Pending final AAB | Required |
| Closed testing | Tester onboarding and bug channel | Prepared | Execute after build |

## Payment Declaration

- DOKU is the primary payment gateway for TapGo v1.0.
- Midtrans remains secondary/fallback while review continues.
- Xendit is not used in TapGo v1.0.
- Membership is activated only after backend confirms valid payment webhook/callback.

## Data Safety Notes

Declare truthfully if used by the app:

- Name and phone number.
- Membership and referral information.
- Wallet/PPOB transaction data.
- Payment status and invoice data.
- Camera/media access if identity/profile upload remains available.
- Device/app diagnostics if collected.

Do not include secret keys or payment credentials in mobile app.

## Pre-Build Checklist

- [ ] DOKU production webhook UAT PASS.
- [ ] Backend production health PASS after deploy.
- [ ] No P0/P1 open bug.
- [ ] Version bumped.
- [ ] Release signing checked.
- [ ] `.env` and credentials not committed.
- [ ] `flutter analyze` PASS.
- [ ] `flutter test` PASS.

## Pre-Upload Checklist

- [ ] AAB signed release.
- [ ] Package/version verified.
- [ ] No localhost/127.0.0.1/10.0.2.2/ngrok/trycloudflare in artifact.
- [ ] No Midtrans/DOKU server secret in artifact.
- [ ] Store listing final.
- [ ] Screenshots final.
- [ ] Data Safety submitted.
- [ ] App access submitted.
- [ ] Content rating submitted.
- [ ] Support email and website active.

## Current Decision

Google Play final release: **PENDING** until payment engine production UAT is complete.

