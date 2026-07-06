# DOKU Production UAT Execution

Status: execution checklist only. Jangan melakukan pembayaran nyata tanpa approval owner.

## Final Endpoint

Canonical webhook endpoint:

```text
POST /api/v1/webhooks/doku
```

Production dashboard URL:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

## Webhook Safety Requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| Raw body | READY | Backend menyimpan raw JSON body untuk signature verification. |
| Signature validation | READY | Missing/invalid header ditolak. |
| Status mapping | READY | Paid, pending, expired, failed, cancelled, unknown diproses eksplisit. |
| Idempotency | READY | Paid webhook ulang tidak proses bonus/referral/ledger lagi. |
| Paid cannot downgrade | READY | Failed/expired/cancelled setelah paid tidak mengubah invoice paid. |
| Bonus/referral no double | READY | Covered by backend integration tests. |

## Test Transaction Policy

1. Jangan gunakan invoice Rp500.000 untuk pembayaran nyata pertama jika owner belum approve.
2. Gunakan nominal kecil/terkontrol hanya jika sistem dan admin policy mengizinkan.
3. Jika nominal kecil tidak didukung oleh business package, lakukan payment UAT dengan order resmi hanya setelah owner menyetujui nominal dan risiko.
4. Jangan aktifkan `snap_direct`.
5. Jangan gunakan Xendit.

## UAT Execution Checklist

| Step | Action | Expected Result | Evidence |
| --- | --- | --- | --- |
| 1 | Deploy backend manual dengan backup | Health PASS | Screenshot/curl output |
| 2 | Set webhook di dashboard DOKU | URL tersimpan | Screenshot dashboard DOKU |
| 3 | Login user test | Login PASS | User ID/order context |
| 4 | Create membership order test | Invoice `PENDING` | Invoice number |
| 5 | Call DOKU create payment | `paymentUrl`/`redirectUrl` keluar | Sanitized response |
| 6 | Buka payment URL | Page DOKU terbuka | Screenshot tanpa credential |
| 7 | Verifikasi nominal | Nominal sesuai approval | Screenshot |
| 8 | Bayar nominal kecil/terkontrol | Payment accepted | Bukti pembayaran |
| 9 | Webhook diterima | HTTP 200 dari backend | PM2 log sanitized |
| 10 | Signature valid | Tidak ada `DOKU_SIGNATURE_INVALID` | Log sanitized |
| 11 | Invoice paid | Invoice `PAID` | DB/admin screenshot |
| 12 | Membership aktif | User membership active | Dashboard/admin |
| 13 | Wallet/referral/bonus aman | Tidak double ledger | Ledger count |
| 14 | Admin dashboard review | Payment terlihat | Admin screenshot |
| 15 | Duplicate webhook observation | Idempotent jika DOKU retry | No duplicate bonus |

## Expected Status Result

| DOKU Event | Expected TapGo Result |
| --- | --- |
| First paid webhook | Invoice `PAID`, order `PAID`, membership active |
| Duplicate paid webhook | Idempotent, no duplicate bonus/referral/ledger |
| Failed after paid | Invoice remains `PAID` |
| Unknown status | No activation |
| Invalid signature | `401 DOKU_SIGNATURE_INVALID` |
| Missing header | `401 DOKU_SIGNATURE_INVALID` |

## Safe Log Review

```bash
pm2 logs tapgo-api --lines 200
```

Do not copy secret values. If payload evidence is needed, redact:

- Authorization
- Signature
- Token
- Secret
- API key
- Private key
- Client secret

## Rollback During UAT

If create payment fails:

1. Keep invoice pending.
2. Do not mark paid manually.
3. Check env and DOKU dashboard.
4. Retry only after root cause is known.

If webhook fails:

1. Do not repeat payment.
2. Capture sanitized DOKU request ID/reference ID.
3. Check signature timestamp/body/proxy behavior.
4. Temporarily stop UAT.
5. Use manual payment handling only with SUPER_ADMIN approval and audit trail.

## Go / No-Go

Public payment readiness is **NO-GO** until this production webhook UAT passes end-to-end.

