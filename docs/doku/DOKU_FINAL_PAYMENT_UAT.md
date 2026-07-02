# DOKU Final Payment UAT

Status dokumen: production stabilization checklist. Dokumen ini tidak menjalankan pembayaran nyata, tidak deploy, dan tidak mengubah flow payment yang sudah stabil.

## Keputusan Gateway

| Gateway | Role TapGo v1.0 | Status |
| --- | --- | --- |
| DOKU | Primary payment gateway | Create payment PASS, webhook code/test ready, real webhook UAT pending |
| Midtrans | Secondary/fallback | Menunggu review/onboarding |
| Xendit | Not used | Tidak masuk flow TapGo v1.0 |

## Audit Final DOKU Checkout

| Area | Status | Bukti Teknis | Risiko Tersisa |
| --- | --- | --- | --- |
| Create payment | PASS | `POST /api/v1/payments/doku/create` memakai DOKU Checkout dan mengembalikan `paymentUrl`/`redirectUrl`. | Validasi production tetap butuh smoke test setelah deploy. |
| Webhook canonical | PASS | `POST /api/v1/webhooks/doku`. Alias lama hanya backward compatibility. | DOKU dashboard harus diarahkan ke URL canonical. |
| Raw body | PASS | Express menyimpan raw body untuk signature validation. | Proxy/VPS tidak boleh mengubah body sebelum backend. |
| Signature | PASS | Header `Client-Id`, `Request-Id`, `Request-Timestamp`, `Signature` wajib valid. | Signature nyata perlu dibuktikan dari payload DOKU production. |
| Status mapping | PASS | `SUCCESS/PAID/SETTLEMENT/CAPTURE`, `PENDING/INITIATED`, `EXPIRED/TIMEOUT`, `FAILED/DENIED/REJECTED`, `CANCELLED/CANCELED/CANCEL`, dan unknown dipetakan eksplisit. | Status baru dari DOKU harus masuk audit sebelum dianggap valid. |
| Invoice paid | PASS by test | Paid webhook memanggil membership payment success flow. | UAT production webhook pending. |
| Membership active | PASS by test | Paid webhook mengaktifkan membership. | UAT production webhook pending. |
| Bonus/referral idempotent | PASS by test | Duplicate paid webhook tidak membuat ledger/bonus dobel. | Monitoring ledger wajib saat UAT nyata. |
| Failed/expired after paid | PASS by test | Jika invoice sudah `PAID`, webhook terminal berikutnya tidak downgrade. | Tidak ada. |

## Test Coverage yang Relevan

File: `apps/backend/tests/payments/doku.integration.test.ts`

- Paid webhook pertama mengaktifkan membership.
- Paid webhook kedua idempotent.
- Create payment Silver Rp500.000 menghasilkan payment URL dan invoice tetap pending.
- Failed webhook setelah paid tidak membalik status paid.
- Unknown status tidak mengaktifkan membership.
- Invalid signature ditolak.
- Missing signature header ditolak.

## UAT Transaksi Nyata yang Aman

UAT nyata hanya boleh dilakukan setelah owner menyetujui nominal dan backend sudah dideploy manual dengan backup.

Rekomendasi:

1. Jangan gunakan invoice produksi Rp500.000 untuk pembayaran nyata pertama.
2. Jika sistem mendukung order test kecil tanpa merusak business report, gunakan nominal kecil yang disetujui owner.
3. Jika sistem belum mendukung nominal test kecil, lakukan UAT webhook dengan order membership resmi hanya setelah owner menerima risiko biaya.
4. Jangan aktifkan `snap_direct`.
5. Jangan gunakan Xendit.

## Webhook URL Production

Set di dashboard DOKU:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

## UAT Payment Steps

1. Backup database dan source VPS.
2. Deploy backend secara manual.
3. Pastikan env production DOKU:
   - `DOKU_ENABLED=true`
   - `DOKU_INTEGRATION_MODE=checkout`
   - `DOKU_ENVIRONMENT=production`
   - `DOKU_BASE_URL=https://api.doku.com`
   - `DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku`
4. Restart PM2 dan cek health.
5. Buat order test yang disetujui.
6. Call create payment.
7. Buka `paymentUrl`.
8. Pastikan nominal, merchant, dan invoice benar.
9. Lakukan pembayaran hanya jika owner sudah menyetujui.
10. Verifikasi webhook diterima dan signature valid.
11. Verifikasi invoice `PAID`, order `PAID`, membership aktif.
12. Verifikasi wallet/bonus/referral hanya terproses sekali.
13. Simpan log sanitized.

## Rollback Plan

Jika create payment atau webhook gagal:

1. Jangan ulang pembayaran sebelum status jelas.
2. Stop traffic payment sementara melalui maintenance notice jika diperlukan.
3. Kembalikan backend ke source backup.
4. Restore database hanya jika ada korupsi data, bukan hanya webhook gagal.
5. Set DOKU dashboard webhook ke endpoint maintenance atau nonaktifkan sementara jika terjadi spam callback.
6. Gunakan manual payment review hanya dengan approval SUPER_ADMIN dan audit trail.

## Go / No-Go

| Item | Status |
| --- | --- |
| Code/test readiness | GO |
| Real production webhook proof | PENDING |
| Public launch payment readiness | NO-GO sampai webhook production UAT PASS |

