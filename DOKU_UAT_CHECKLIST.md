# TapGo DOKU Checkout UAT Checklist

Dokumen ini menyiapkan UAT DOKU Checkout untuk TapGo tanpa menyimpan credential asli di repository.

## Scope

- Payment gateway aktif untuk UAT: DOKU Checkout.
- Mode integrasi final tahap ini: `DOKU_INTEGRATION_MODE=checkout`.
- Canonical create payment endpoint: `POST /api/v1/payments/doku/create`.
- Canonical webhook endpoint: `POST /api/v1/webhooks/doku`.
- Admin-only payment status endpoint: `GET /api/v1/payments/doku/status/:referenceId`.
- `snap_direct` tidak aktif dan hanya disiapkan sebagai future mode.
- Midtrans/manual payment flow lama tidak dihapus.

## Environment Variables

Isi hanya di backend `.env`. Jangan menaruh credential DOKU di Flutter/mobile app, landing page, atau file client-side.

```env
DOKU_ENABLED=true
DOKU_INTEGRATION_MODE=checkout
DOKU_ENVIRONMENT=sandbox
DOKU_BASE_URL=https://api-sandbox.doku.com
DOKU_CLIENT_ID=isi_dari_dashboard_doku
DOKU_SECRET_KEY=isi_dari_dashboard_doku
DOKU_API_KEY=isi_jika_diberikan_doku
DOKU_PUBLIC_KEY=isi_jika_diberikan_doku
DOKU_MERCHANT_PUBLIC_KEY=isi_jika_diberikan_doku
DOKU_WEBHOOK_SECRET=isi_jika_digunakan_untuk_signature_webhook
DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku
```

Production memakai pola yang sama, tetapi:

```env
DOKU_ENVIRONMENT=production
DOKU_BASE_URL=https://api.doku.com
DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku
```

Catatan:

- Jangan commit `.env`, key, secret, token, atau private key.
- Backend membaca DOKU credential dari `apps/backend/src/lib/doku/config.ts`.
- Frontend Flutter hanya memanggil backend TapGo. Frontend tidak menyimpan DOKU secret.
- `NEXT_PUBLIC_DOKU_ENABLED` tidak digunakan untuk backend DOKU.

## Cara Set Webhook di Dashboard DOKU

Gunakan URL production canonical:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

Checklist dashboard DOKU:

- Pastikan merchant environment sesuai credential yang dipakai.
- Aktifkan payment channel yang dibutuhkan: VA, QRIS, e-wallet, dan channel lain yang disetujui DOKU.
- Set notification/webhook URL ke endpoint canonical di atas.
- Simpan perubahan dan lakukan test notification dari dashboard jika tersedia.

## Cara Test Lokal

1. Siapkan database test/lokal yang bukan production.
2. Isi `apps/backend/.env` dengan DOKU sandbox credential.
3. Pastikan mode tetap checkout:

```bash
DOKU_ENABLED=true
DOKU_INTEGRATION_MODE=checkout
DOKU_ENVIRONMENT=sandbox
```

4. Jalankan backend:

```bash
npm --workspace apps/backend run dev
```

5. Login user test dan buat membership order Silver.
6. Panggil create payment:

```bash
curl -X POST http://localhost:4000/api/v1/payments/doku/create \
  -H "Authorization: Bearer <USER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"<MEMBERSHIP_ORDER_ID>"}'
```

Expected:

- Response `success: true`.
- `data.paymentUrl` atau `data.redirectUrl` tersedia.
- `data.referenceId` terisi invoice/order reference.
- Invoice/order tetap `PENDING` sampai webhook paid diterima.

## Cara Test Production UAT

Jangan lakukan transaksi production sebelum owner menyetujui.

1. Pastikan VPS sudah backup.
2. Pastikan `.env` production berisi DOKU production credential.
3. Pastikan `DOKU_INTEGRATION_MODE=checkout`.
4. Pastikan webhook dashboard DOKU mengarah ke:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

5. Buat order Silver Rp500.000 dari akun UAT.
6. Klik bayar dan pastikan user diarahkan ke `paymentUrl`.
7. Setelah pembayaran sandbox/production UAT berhasil, cek:

- invoice menjadi `PAID`
- membership menjadi aktif
- PPOB benefit sesuai paket
- sponsor/referral bonus tidak diproses dobel
- wallet ledger tidak dobel

## Flow UAT Silver Rp500.000

| Step | Expected Result |
| --- | --- |
| Create membership order Silver | Order dan invoice terbentuk dengan nominal Rp500.000 |
| Create DOKU checkout payment | Backend menerima `paymentUrl`, `referenceId`, dan `expiredAt` |
| Before webhook | Order, invoice, dan payment tetap `PENDING` |
| Webhook paid pertama | Invoice `PAID`, membership aktif, benefit/bonus diproses sekali |
| Webhook paid kedua | Idempotent, tidak ada bonus/referral/ledger dobel |
| Failed webhook setelah paid | Tidak membalik status paid menjadi failed |
| Admin check status | `GET /api/v1/payments/doku/status/:referenceId` hanya untuk ADMIN/SUPER_ADMIN |

## Capture Payload Webhook Asli dengan Aman

Gunakan script capture hanya untuk UAT/troubleshooting. Script ini meredact header/body sensitif sebelum menulis file.

```bash
npm --workspace apps/backend run doku:capture-webhook
```

Opsional:

```bash
DOKU_CAPTURE_PORT=5055 \
DOKU_CAPTURE_DIR=doku-webhook-captures \
npm --workspace apps/backend run doku:capture-webhook
```

Lalu arahkan webhook DOKU sementara ke tunnel/dev URL yang mengarah ke:

```text
POST /api/v1/webhooks/doku
```

Yang tidak disimpan:

- `Signature`
- `Authorization`
- token
- API key
- secret key
- private key

File hasil capture tersimpan di folder `doku-webhook-captures/` atau folder yang diset melalui `DOKU_CAPTURE_DIR`.

## Checklist Sebelum Go-Live DOKU

- `DOKU_ENABLED=true`.
- `DOKU_INTEGRATION_MODE=checkout`.
- `DOKU_ENVIRONMENT=production`.
- `DOKU_BASE_URL=https://api.doku.com`.
- Semua credential DOKU hanya ada di backend `.env`.
- Webhook dashboard DOKU memakai `https://api.tapgolion.id/api/v1/webhooks/doku`.
- Payment channel DOKU aktif.
- Create payment Silver Rp500.000 berhasil.
- Webhook paid berhasil mengaktifkan membership.
- Duplicate webhook tidak memproses bonus dua kali.
- Admin status check hanya dapat diakses `ADMIN`/`SUPER_ADMIN`.
- Error response tetap user-friendly.
- Midtrans/manual payment flow lama tetap tersedia sebagai fallback operasional.
- Tidak ada credential di log, source code, Flutter app, APK/AAB, atau dokumentasi.
