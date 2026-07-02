# TapGo Project Status

Tanggal status: 2026-07-02

Mode kerja: Production Stabilization.

## Executive Summary

TapGo sudah memiliki payment architecture v1.0 yang jelas: DOKU sebagai primary gateway, Midtrans sebagai secondary/fallback, dan Xendit tidak digunakan. Production launch belum boleh dilakukan sampai DOKU production webhook UAT selesai dan semua checklist closed beta/Google Play final disetujui owner.

## Progress Keseluruhan

| Area | Status | Catatan |
| --- | --- | --- |
| Backend core | READY FOR UAT | Build/test lokal PASS. |
| DOKU create payment | PASS | Production endpoint pernah menghasilkan payment URL. |
| DOKU webhook | READY FOR REAL UAT | Unit/integration coverage PASS; real production notification pending. |
| Midtrans | WAITING REVIEW | Secondary/fallback sambil onboarding/review selesai. |
| Xendit | NOT USED | Tidak masuk TapGo v1.0. |
| Flutter user app | READY FOR VALIDATION | Analyze/test PASS; AAB tidak dibuild pada fase ini. |
| Google Play | PREPARED, NOT READY FOR PRODUCTION | Menunggu DOKU webhook UAT dan owner action di Play Console. |
| Documentation | UPDATED | Fase 1-6 roadmap docs dibuat. |

## Status Modul

| Modul | Status | Next Check |
| --- | --- | --- |
| Auth/register/login | Stable by current test scope | UAT manual role. |
| Membership | Stable by backend tests | UAT DOKU paid webhook. |
| Invoice/payment | DOKU-ready | Real webhook UAT. |
| Wallet/PPOB | Stable by prior tests | Manual UAT ledger/cash/PPOB. |
| Referral/bonus | Idempotent by tests | Verify after real webhook. |
| Admin review | Prepared | Manual UAT. |
| Withdraw | Prepared | Manual UAT cash-only. |

## Blocker

1. DOKU production webhook belum dibuktikan dengan payload nyata dari dashboard DOKU.
2. Deploy backend production belum dilakukan pada fase ini.
3. Google Play production tidak boleh lanjut sebelum payment UAT PASS.
4. Midtrans masih menunggu review sebagai fallback.

## Next Milestone

Manual owner/deployment milestone:

1. Backup VPS.
2. Deploy backend manual.
3. Set DOKU webhook: `https://api.tapgolion.id/api/v1/webhooks/doku`.
4. Jalankan small controlled payment UAT.
5. Verifikasi invoice paid, membership active, wallet/referral idempotent.
6. Baru lanjut final AAB/Google Play step.

## Go / No-Go

| Target | Decision |
| --- | --- |
| Deploy manual backend | GO with backup and owner approval |
| DOKU webhook production UAT | GO after deploy |
| Public launch | NO-GO |
| Google Play production upload | NO-GO |
| Closed beta preparation | GO |

