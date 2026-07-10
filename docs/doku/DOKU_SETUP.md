# DOKU Setup TapGo

Dokumen ini menjelaskan konfigurasi DOKU Checkout untuk TapGo.

## Mode Integrasi

Mode production tahap pertama:

```env
DOKU_INTEGRATION_MODE=checkout
```

Direct API / SNAP Direct belum aktif dan tidak boleh dipakai sebelum implementasi serta test lengkap.

## Environment Backend

Isi di `apps/backend/.env` dari dashboard DOKU:

```env
DOKU_ENABLED=true
DOKU_INTEGRATION_MODE=checkout
DOKU_CLIENT_ID=
DOKU_SECRET_KEY=
DOKU_API_KEY=
DOKU_PUBLIC_KEY=
DOKU_MERCHANT_PUBLIC_KEY=
DOKU_ENVIRONMENT=sandbox
DOKU_BASE_URL=https://api-sandbox.doku.com
DOKU_WEBHOOK_SECRET=
DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku
```

Untuk production DOKU:

```env
DOKU_ENVIRONMENT=production
DOKU_BASE_URL=https://api.doku.com
```

Jangan commit credential asli.

## Endpoint yang Digunakan

Create payment:

```text
POST /api/v1/payments/doku/create
```

Webhook:

```text
POST /api/v1/webhooks/doku
```

Check status:

```text
GET /api/v1/payments/doku/status/:referenceId
```

## Webhook Dashboard DOKU

Set URL webhook di dashboard DOKU:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

Pastikan DOKU mengirim header:

- `Client-Id`
- `Request-Id`
- `Request-Timestamp`
- `Signature`

## Flow Pembayaran

1. User membuat membership order.
2. Backend membuat invoice `PENDING`.
3. User klik `Bayar Sekarang`.
4. Backend memanggil DOKU Checkout.
5. DOKU mengembalikan `paymentUrl`.
6. App membuka `paymentUrl`.
7. DOKU mengirim webhook.
8. Backend verifikasi signature.
9. Jika status paid, backend menjalankan activation engine existing.
10. Invoice menjadi `PAID`, membership aktif, bonus/ledger diproses sekali.

## Cara Test Sandbox

1. Isi env sandbox DOKU.
2. Jalankan backend lokal/staging.
3. Login user test.
4. Buat order Silver Rp500.000.
5. Klik bayar.
6. Pastikan response memiliki `paymentUrl`.
7. Buka payment URL.
8. Simulasikan pembayaran sesuai dashboard DOKU.
9. Pastikan webhook masuk ke `/api/v1/webhooks/doku`.
10. Cek invoice/order berubah menjadi `PAID`.

## Cara Cek Status Invoice

Admin/Super Admin dapat memakai:

```text
GET /api/v1/payments/doku/status/:referenceId
```

Di aplikasi, tombol `Check DOKU Status` muncul di detail payment DOKU.

## Rollback ke Manual/Midtrans Flow Jika DOKU Error

Tanpa deploy kode baru, backend dapat mematikan DOKU:

```env
DOKU_ENABLED=false
```

Lalu restart backend. Flow Midtrans lama tetap tidak dihapus.

Catatan:

- Invoice yang sudah dibuat tetap `PENDING`.
- Payment DOKU gagal tidak mengaktifkan membership.
- Admin dapat retry create payment setelah DOKU aktif kembali.
