# DOKU Webhook End-to-End UAT

Dokumen ini digunakan untuk membuktikan webhook DOKU Checkout berjalan end-to-end sebelum TapGo public launch.

## Scope

- Gateway utama TapGo v1.0: DOKU Checkout.
- Endpoint create payment: `POST /api/v1/payments/doku/create`.
- Endpoint webhook production: `POST /api/v1/webhooks/doku`.
- Webhook URL production:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

## Readiness yang Harus Dibuktikan

| Area | Expected Result |
| --- | --- |
| Raw body | Backend menyimpan raw request body sementara untuk signature verification |
| Signature | Header DOKU diverifikasi sebelum status diproses |
| Status mapping | Paid, pending, failed, expired, cancelled, dan unknown diproses eksplisit |
| Idempotency | Duplicate paid webhook tidak membuat bonus/ledger dobel |
| Paid flow | Invoice menjadi `PAID`, order `PAID`, membership aktif |
| Safety | Failed/expired setelah paid tidak downgrade status paid |
| Unknown status | Tidak mengaktifkan membership dan disimpan untuk audit |

## Header yang Dibutuhkan

- `Client-Id`
- `Request-Id`
- `Request-Timestamp`
- `Signature`

Jika header hilang atau signature invalid, backend harus mengembalikan `401 DOKU_SIGNATURE_INVALID`.

## Status Mapping

| DOKU Status | TapGo Result |
| --- | --- |
| `SUCCESS`, `PAID`, `SETTLEMENT`, `CAPTURE` | Mark paid |
| `PENDING`, `INITIATED` | Keep pending |
| `EXPIRED`, `TIMEOUT` | Expired only if invoice masih pending |
| `FAILED`, `FAILURE`, `DENIED`, `DENY`, `REJECTED` | Failed only if invoice masih pending |
| `CANCELLED`, `CANCELED`, `CANCEL` | Cancelled only if invoice masih pending |
| Unknown status | Store warning/metadata, do not activate |

## UAT Steps

1. Deploy backend manually after backup.
2. Set DOKU webhook dashboard to:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

3. Create a small approved test order. Do not pay the Rp500.000 invoice unless owner approves.
4. Create DOKU Checkout payment.
5. Open payment URL only after confirming nominal is safe.
6. Complete payment.
7. Monitor backend logs:

```bash
pm2 logs tapgo-api --lines 200
```

8. Verify invoice/order/user state.
9. Retry or let DOKU resend webhook once to confirm idempotency.

## Expected UAT Matrix

| Case | Expected |
| --- | --- |
| First paid webhook | Invoice `PAID`, membership active, benefit processed once |
| Second paid webhook | Idempotent, no duplicate bonus/referral/ledger |
| Failed after paid | Paid state remains paid |
| Expired after paid | Paid state remains paid |
| Unknown status | No activation |
| Invalid signature | `401 DOKU_SIGNATURE_INVALID` |
| Missing signature header | `401 DOKU_SIGNATURE_INVALID` |

## Safe Logging

The backend redacts:

- Authorization
- Signature
- token
- secret
- API key
- private key
- password

Use sanitized capture only for troubleshooting:

```bash
npm --workspace apps/backend run doku:capture-webhook
```

Do not commit captured payload files.

## Current Status

- DOKU create payment: PASS with production endpoint.
- DOKU webhook UAT: pending real DOKU production notification.
- Production payment channel: must be confirmed active in DOKU dashboard.
