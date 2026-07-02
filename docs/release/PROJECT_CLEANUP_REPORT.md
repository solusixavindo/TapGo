# TapGo Project Cleanup Report

Date: 2026-07-02

## Summary

Workspace cleanup and documentation organization completed without deleting source code, legal files, APK/AAB release artifacts, `.env`, `.env.example`, `.env.production.example`, DOKU documents, or Midtrans documents.

## Size

- Before cleanup: `3.5G`
- After cleanup: `1.4G`
- Approximate reduction: `2.1G`

## Deleted Temporary Files/Folders

- `apps/user_app/build/`
- `apps/driver_app/build/`
- `apps/backend/dist/`
- `apps/backend/coverage/`
- `apps/landing-page/.next/`
- `apps/landing-page/.next.broken-preview/`
- `apps/landing-page/out/`
- `apps/landing-page/dist/`
- `DNB_XAVINDO_DUNS_UPLOAD/__pycache__/`
- All `.DS_Store` files found in the workspace.

## Preserved Important Files/Folders

- `node_modules/`
- `apps/`
- `infra/`
- `scripts/`
- `.env`
- `.env.example`
- `.env.production.example`
- `dist/*.apk`
- `google-play-assets/releases/*.aab`
- Merchant verification ZIP files.
- Legal and company verification files.
- DOKU and Midtrans final documents.

## Documentation Folders

- `docs/doku/` - DOKU setup, UAT, webhook, and integration docs.
- `docs/midtrans/` - Midtrans onboarding, verification, and transaction flow docs.
- `docs/legal/` - Legal, SOP, security, compliance, and D&B documents.
- `docs/release/` - Google Play, UAT, launch, deploy, and release docs.
- `docs/archive/` - Historical audits, investor decks, and older planning reports.

## Key Moved Documents

### DOKU

- `DOKU_PAYMENT_INTEGRATION_REPORT.md` -> `docs/doku/`
- `DOKU_PRODUCTION_WEBHOOK_UAT_CHECKLIST.md` -> `docs/doku/`
- `DOKU_SETUP.md` -> `docs/doku/`
- `DOKU_UAT_CHECKLIST.md` -> `docs/doku/`

### Midtrans

- `MIDTRANS_TRANSACTION_FLOW_TAPGO_FINAL.pdf` -> `docs/midtrans/`
- `MIDTRANS_TRANSACTION_FLOW_WITH_CHANNEL_BLOCKER.pdf` -> `docs/midtrans/`
- `MIDTRANS_ONBOARDING_TRANSACTION_FLOW.pdf` -> `docs/midtrans/`
- `MIDTRANS_VERIFICATION_PACKAGE.zip` -> `docs/midtrans/`
- `MIDTRANS_VERIFICATION_PT_TAPGO_LION_INDONESIA.zip` -> `docs/midtrans/`
- `MIDTRANS_ONBOARDING_TAPGO/` -> `docs/midtrans/`
- `MIDTRANS_ONBOARDING_TAPGO_V3/` -> `docs/midtrans/`
- `MIDTRANS_ONBOARDING_TAPGO_V3_FINAL/` -> `docs/midtrans/`
- `MIDTRANS_VERIFICATION/` -> `docs/midtrans/`

### Legal

- `DNB_XAVINDO_DUNS_UPLOAD/` -> `docs/legal/`
- `DNB_XAVINDO_DUNS_UPLOAD.zip` -> `docs/legal/`
- `LEGAL_COMPLIANCE_AUDIT.md` -> `docs/legal/`
- SOP finance/support documents -> `docs/legal/`

### Release and UAT

- Google Play readiness reports -> `docs/release/`
- AAB v3 release reports -> `docs/release/`
- UAT reports and checklists -> `docs/release/`
- User guide, FAQ, launch pack, and tester guide -> `docs/release/`

### Archive

- Business engine audit reports -> `docs/archive/`
- Founder program design docs -> `docs/archive/`
- Anti-abuse and device fingerprint planning -> `docs/archive/`
- Investor deck files -> `docs/archive/`

## Build Validation

Command:

```bash
npm --workspace apps/backend run build
```

Result: PASS

The generated `apps/backend/dist/` folder was removed again after validation to keep the workspace clean.

## Notes

- No deployment was performed.
- No APK/AAB was built.
- No production migration was run.
- No credential was committed.
- No source code was deleted.
- Midtrans flow was not changed.
- DOKU production webhook checklist remains available at `docs/doku/DOKU_PRODUCTION_WEBHOOK_UAT_CHECKLIST.md`.
