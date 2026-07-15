# TapGo Project Structure

Struktur ini adalah struktur workspace setelah cleanup dan pengelompokan dokumen.

```text
Tapgo/
├── apps/
│   ├── backend/              # Node.js/Express API, Prisma, payment gateway integration
│   ├── user_app/             # Flutter TapGo user application
│   ├── driver_app/           # Flutter driver app workspace
│   ├── admin_dashboard/      # Admin dashboard frontend
│   └── landing-page/         # TapGo landing page and policy pages
├── docs/
│   ├── doku/                 # DOKU setup, UAT, webhook, integration docs
│   ├── midtrans/             # Midtrans onboarding, verification, transaction flow docs
│   ├── legal/                # Legal, SOP, compliance, D&B package docs
│   ├── release/              # Google Play, UAT, deploy, recovery, launch, release docs
│   ├── master-blueprint/     # TapGo Master Blueprint 2026-2035 package
│   ├── archive/              # Historical audits, old plans, investor deck sources
│   ├── architecture/         # Existing architecture documentation
│   └── referral/             # Existing referral/wallet/membership documentation
├── google-play-assets/
│   ├── releases/             # AAB release artifacts
│   └── screenshots/          # Google Play screenshot assets
├── infra/                    # Local Docker services and infrastructure config
├── packages/                 # Shared workspace packages
├── scripts/                  # Operational scripts and safe webhook capture scripts
├── tools/                    # Validation and utility tools
├── dist/                     # Preserved APK/UAT release artifacts
├── ARCHIVE.md                # Index for important documents and artifacts
├── CHANGELOG.md              # Release changelog
├── PROJECT_STRUCTURE.md      # This file
├── README.md                 # Main project README
├── package.json              # Workspace package manifest
└── package-lock.json         # Workspace lockfile
```

## Source Code Locations

- Backend API: `apps/backend/src/`
- Backend Prisma schema and migrations: `apps/backend/prisma/`
- Flutter user app: `apps/user_app/lib/`
- Flutter user Android project: `apps/user_app/android/`
- Landing page app: `apps/landing-page/src/`

## Payment Gateway Documentation

- DOKU docs: `docs/doku/`
- Midtrans docs: `docs/midtrans/`
- Payment status: `docs/release/PAYMENT_GATEWAY_STATUS.md`
- DOKU webhook UAT: `docs/doku/DOKU_WEBHOOK_END_TO_END_UAT.md`
- DOKU final payment UAT: `docs/doku/DOKU_FINAL_PAYMENT_UAT.md`
- DOKU production UAT execution: `docs/doku/DOKU_PRODUCTION_UAT_EXECUTION.md`
- DOKU merchant clarification response: `docs/doku/DOKU_BUSINESS_FLOW_RESPONSE.md`
- DOKU premium merchant verification book: `docs/doku/TAPGO_DOKU_MERCHANT_VERIFICATION_BOOK.pdf`
- DOKU final email response: `docs/doku/DOKU_EMAIL_RESPONSE_FINAL.md`

## Operational Documentation

- Release and UAT docs: `docs/release/`
- Deployment guide: `docs/release/DEPLOYMENT_GUIDE.md`
- Final production deploy steps: `docs/release/FINAL_PRODUCTION_DEPLOY_STEPS.md`
- Recovery guide: `docs/release/RECOVERY_GUIDE.md`
- Production readiness checklist: `docs/release/PRODUCTION_READINESS_CHECKLIST.md`
- Production infrastructure audit: `docs/release/PRODUCTION_INFRASTRUCTURE_AUDIT.md`
- Internal UAT checklist: `docs/release/INTERNAL_UAT_CHECKLIST.md`
- Closed beta plan: `docs/release/CLOSED_BETA_PLAN.md`
- Google Play production readiness: `docs/release/GOOGLE_PLAY_PRODUCTION_READINESS.md`
- Google Play final release checklist: `docs/release/GOOGLE_PLAY_FINAL_RELEASE_CHECKLIST.md`
- Google Play closed testing plan: `docs/release/GOOGLE_PLAY_CLOSED_TESTING_PLAN.md`
- Release workflow: `docs/release/RELEASE_WORKFLOW.md`
- Versioning policy: `docs/release/VERSIONING_POLICY.md`
- Founder Platinum implementation report: `docs/release/FOUNDER_PLATINUM_IMPLEMENTATION_REPORT.md`
- Founder Platinum admin guide: `docs/release/FOUNDER_PLATINUM_ADMIN_GUIDE.md`
- Legal and SOP docs: `docs/legal/`
- TapGo Master Blueprint 2026-2035: `docs/master-blueprint/`
- Historical audit docs: `docs/archive/`
- Current project status: `PROJECT_STATUS.md`

## Cleanup Policy

Safe to regenerate and keep untracked/ignored:

- `apps/*/build/`
- `apps/backend/dist/`
- `apps/backend/coverage/`
- `apps/landing-page/.next/`
- `apps/landing-page/out/`
- `.DS_Store`
- `__pycache__/`

Do not delete without explicit approval:

- `.env`
- `.env.example`
- `.env.production.example`
- `apps/backend/`
- `apps/user_app/`
- `infra/`
- `scripts/`
- `docs/doku/`
- `docs/midtrans/`
- `docs/legal/`
- `google-play-assets/releases/`
- `dist/`
