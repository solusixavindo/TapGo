# TapGo Project Status

Tanggal status: 2026-07-06

Mode kerja: Production Stabilization.

## Executive Summary

TapGo berada pada fase Pre-Production dengan progress keseluruhan 97%. Payment architecture v1.0 sudah dikunci: DOKU sebagai primary gateway, Midtrans sebagai secondary/fallback, dan Xendit tidak digunakan. Target berikutnya adalah deploy backend manual, set webhook DOKU, lalu menjalankan DOKU Production Webhook UAT dengan transaksi nyata terkontrol.

## Progress Keseluruhan

| Area | Status | Catatan |
| --- | --- | --- |
| Overall progress | 97% | Sisa utama: deploy manual, webhook DOKU production UAT, final Google Play release. |
| Current phase | PRE-PRODUCTION | Stabilization dan execution planning. |
| Next milestone | DOKU PRODUCTION WEBHOOK UAT | Butuh deploy manual dan payment test terkontrol. |
| Backend core | READY FOR PRODUCTION DEPLOY PREP | Build/test lokal PASS. |
| DOKU create payment | PASS | Production endpoint pernah menghasilkan payment URL. |
| DOKU webhook code/test | PASS | Unit/integration coverage PASS; real production notification pending. |
| DOKU production UAT | PENDING MANUAL DEPLOY/PAYMENT | Butuh set webhook dashboard DOKU dan transaksi nyata terkontrol. |
| Midtrans | WAITING REVIEW | Secondary/fallback sambil onboarding/review selesai. |
| Xendit | NOT USED | Tidak masuk TapGo v1.0. |
| Flutter user app | READY FOR VALIDATION | Analyze/test PASS; AAB tidak dibuild pada fase ini. |
| Google Play | PENDING AFTER PAYMENT ENGINE STABLE | Jangan build/upload final sebelum DOKU UAT PASS. |
| Documentation | UPDATED | Final deploy steps, DOKU UAT execution, dan Google Play final checklist dibuat. |

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
