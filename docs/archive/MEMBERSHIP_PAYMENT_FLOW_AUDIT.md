# Membership Payment Flow Audit

Tanggal audit: 16 Juni 2026

Scope: audit read-only order membership, invoice, Midtrans Snap, payment notification, idempotency, dan status payment.

## Ringkasan

Status: **PASS dengan WARNING**

Flow payment membership sudah menggunakan pola aman:

1. User membuat membership order.
2. Invoice dan payment pending dibuat.
3. Pay endpoint membuat Midtrans Snap token.
4. Webhook Midtrans diverifikasi signature di production.
5. Bonus/benefit hanya diposting setelah status success memanggil `markPaymentSuccess`.
6. Pending/failed/expired/cancelled tidak memicu bonus.
7. Duplicate paid callback ditahan oleh update invoice pending dan idempotency handling.

WARNING: payment channel Midtrans masih menunggu aktivasi onboarding; ini bukan bug engine, tetapi blocker transaksi real.

## Evidence Source

- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:52` sampai `125`: create order/invoice/payment pending.
- `apps/backend/src/modules/payments/application/MidtransPaymentService.ts:46` sampai `170`: pay endpoint membuat/reuse Snap token.
- `apps/backend/src/modules/payments/application/MidtransPaymentService.ts:172` sampai `253`: notification handler.
- `apps/backend/src/modules/payments/application/MidtransPaymentService.ts:297` sampai `344`: signature verification.
- `apps/backend/src/modules/payments/application/MidtransPaymentService.ts:346` sampai `400`: status success/pending/terminal mapping.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts:177` sampai `190`: invoice hanya bisa berubah dari PENDING ke PAID sekali.

## Flow Status

| Tahap | Implementasi | Status |
| --- | --- | --- |
| Create order | MembershipOrder PENDING + Invoice PENDING + Payment PENDING | PASS |
| Create Snap | Hanya order/invoice PENDING yang payable | PASS |
| Reuse Snap | Pending payment dengan snapToken/redirectUrl direuse | PASS |
| Webhook success | settlement/capture memanggil `markPaymentSuccess` | PASS |
| Webhook pending | update metadata payment tanpa benefit/bonus | PASS |
| Webhook failed/expired/cancelled | mark terminal, tidak memicu bonus | PASS |
| Signature production | Production wajib server key dan signature valid | PASS |
| Duplicate paid | Invoice update PENDING -> PAID atomic; duplicate dianggap idempotent | PASS |

## Risiko

| Temuan | Risiko | Prioritas |
| --- | --- | --- |
| Midtrans payment channel belum aktif | User tidak bisa menyelesaikan pembayaran real walau Snap token tersedia | P1 |
| Initial payment method `DEVELOPMENT_PLACEHOLDER` sebelum Snap dibuat | Bisa membingungkan report jika payment belum diproses Snap | P2 |
| Manual/admin approval endpoint dapat memanggil `markPaymentSuccess` | Perlu SOP ketat agar admin tidak mengaktifkan membership tanpa bukti payment/approval sah | P1 |

## Kesimpulan

Payment engine siap secara teknis untuk Closed Testing dan retest Midtrans channel. Public launch menunggu aktivasi channel Midtrans dan SOP admin approval/payment evidence.

