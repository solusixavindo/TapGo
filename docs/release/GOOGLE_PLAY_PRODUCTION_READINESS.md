# Google Play Production Readiness

Status: preparation only. Jangan build AAB dan jangan upload Play Console dari dokumen ini.

## Android Release Audit

| Item | Expected | Status |
| --- | --- | --- |
| Package name | `id.tapgolion.tapgo` | Verify before final build |
| Version code/name | Naik dari build terakhir | Verify before final build |
| Keystore | Release signing, no debug fallback | Verify before final build |
| AAB readiness | Build hanya setelah payment UAT PASS | Pending |
| App icon | Brand TapGo resmi | Prepared from prior assets |
| Feature graphic | 1024 x 500 | Prepared from prior assets |
| Screenshots | User-facing screenshots final | Partial/prepared, verify latest |
| Privacy Policy | Published URL required | Docs available |
| Terms | Published URL recommended | Docs available |
| Data Safety | Camera/media/storage/payment/user data declared | Draft available, final owner review required |
| App access | Provide tester/reviewer access | Owner action required |
| Content rating | Complete Play questionnaire | Owner action required |
| Account deletion | URL/instruction available | Verify landing page before production |
| Support email | `support@tapgolion.id` | Required |
| Website | `https://tapgolion.id` | Required |

## Payment Disclosure

- Primary gateway: DOKU.
- Secondary/fallback: Midtrans.
- Xendit: not used in TapGo v1.0.
- Membership activation only after backend validates payment callback/webhook.
- Do not claim guaranteed profit or guaranteed income.

## Pre-Upload Checklist

- [ ] DOKU production webhook UAT PASS.
- [ ] AAB versionCode bumped.
- [ ] Release signing verified.
- [ ] No localhost/ngrok/trycloudflare in release artifact.
- [ ] No server keys in mobile artifact.
- [ ] Privacy Policy URL live.
- [ ] Terms URL live.
- [ ] Data Safety final submitted.
- [ ] App access credentials valid.
- [ ] Payment reviewer notes mention DOKU primary and Midtrans fallback only if needed.

## Recommendation

Google Play production upload is **NO-GO** until DOKU webhook production UAT passes and owner approves final AAB build.

