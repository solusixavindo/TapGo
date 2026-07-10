# DOKU Production Webhook UAT Checklist

Dokumen ini menyiapkan UAT webhook DOKU production untuk TapGo dengan transaksi kecil. Jangan memakai invoice membership Rp500.000 untuk pembayaran nyata kecuali owner menyetujui risiko biaya dan aktivasi membership.

## Status Saat Ini

- DOKU create payment sudah PASS dengan production endpoint.
- `paymentUrl`/`redirectUrl` berhasil keluar.
- Canonical create payment endpoint: `POST /api/v1/payments/doku/create`.
- Canonical webhook endpoint: `POST /api/v1/webhooks/doku`.
- Production webhook URL untuk dashboard DOKU:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

## Prinsip UAT

- Jangan membayar invoice Rp500.000 untuk test webhook.
- Jangan deploy otomatis.
- Jangan commit credential.
- Jangan build APK/AAB.
- Jangan mengubah Midtrans/manual flow lama.
- Jangan membuka atau membayar checkout link production kecuali nominal sudah aman dan disetujui owner.

## Opsi Order Test Nominal Kecil

### Opsi A - Recommended

Minta DOKU menyediakan cara test production callback atau payment channel test dengan nominal kecil tanpa aktivasi transaksi real. Gunakan hanya jika DOKU mengonfirmasi metode tersebut aman.

### Opsi B - Staging/UAT Backend

Gunakan environment UAT/staging yang terpisah dari production DB, lalu buat package/order nominal kecil khusus UAT. Ini tidak boleh masuk production report, revenue report, PPOB liability, atau komisi production.

### Opsi C - Production Order Kecil

Hanya boleh dilakukan jika sistem sudah mendukung paket test nominal kecil yang:

- dibuat oleh SUPER_ADMIN,
- ditandai sebagai UAT/internal test,
- tidak mengakui revenue production normal,
- tidak memberi PPOB benefit,
- tidak memicu bonus/referral/commission production,
- tidak terlihat ke user publik.

Jika fitur ini belum ada, jangan membuat transaksi production kecil secara manual lewat data production tanpa approval owner.

## Backend Readiness Sebelum Deploy Manual

Pastikan source di VPS sudah berisi DOKU hardening berikut:

- `DOKU_ENABLED=true`.
- `DOKU_INTEGRATION_MODE=checkout`.
- `DOKU_ENVIRONMENT=production`.
- `DOKU_BASE_URL=https://api.doku.com`.
- Secret DOKU hanya berada di backend `.env`.
- Flutter/mobile app tidak menyimpan secret DOKU.
- Endpoint create payment canonical tersedia: `/api/v1/payments/doku/create`.
- Endpoint webhook canonical tersedia: `/api/v1/webhooks/doku`.
- Alias lama tidak dipakai dalam dokumentasi production.
- `snap_direct` tetap tidak aktif.
- Midtrans/manual flow lama tetap tersedia sebagai fallback operasional.

## Command Deploy Backend Manual

Jalankan hanya setelah backup production dibuat.

```bash
cd /var/www/Tapgo
git status
git pull
npm ci
npx prisma generate --schema apps/backend/prisma/schema.prisma
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
```

Jika ada migration baru di luar tahap ini, deploy migration harus melalui approval terpisah. Untuk UAT webhook ini tidak perlu migration baru.

## Environment Production VPS

Isi langsung di `.env` backend VPS. Jangan tulis credential di chat, ticket publik, atau repository.

```env
DOKU_ENABLED=true
DOKU_INTEGRATION_MODE=checkout
DOKU_ENVIRONMENT=production
DOKU_BASE_URL=https://api.doku.com
DOKU_CLIENT_ID=isi_dari_dashboard_doku
DOKU_SECRET_KEY=isi_dari_dashboard_doku
DOKU_API_KEY=isi_jika_diperlukan
DOKU_PUBLIC_KEY=isi_jika_diperlukan
DOKU_MERCHANT_PUBLIC_KEY=isi_jika_diperlukan
DOKU_WEBHOOK_SECRET=isi_jika_DOKU_menyediakan_secret_khusus_webhook
DOKU_WEBHOOK_URL=https://api.tapgolion.id/api/v1/webhooks/doku
```

Jika `DOKU_WEBHOOK_SECRET` kosong, backend memakai `DOKU_SECRET_KEY` sebagai fallback signature secret.

## Cara Set Webhook di Dashboard DOKU

1. Login dashboard merchant DOKU production.
2. Buka menu konfigurasi callback/notification/webhook.
3. Set URL:

```text
https://api.tapgolion.id/api/v1/webhooks/doku
```

4. Pastikan environment dashboard adalah production.
5. Pastikan payment channel yang akan diuji sudah aktif.
6. Simpan konfigurasi.
7. Jika tersedia tombol test notification, gunakan untuk mengirim payload test.

## Webhook Endpoint Readiness

Endpoint `POST /api/v1/webhooks/doku` sudah siap menerima payload production dengan:

- JSON body hingga 1 MB.
- Raw body disimpan sementara di request untuk verifikasi signature.
- Header DOKU yang dibaca:
  - `Client-Id`
  - `Request-Id`
  - `Request-Timestamp`
  - `Signature`
- Signature diverifikasi memakai format HMAC DOKU yang sama dengan request checkout.
- Status DOKU dipetakan eksplisit:
  - `SUCCESS`, `PAID`, `SETTLEMENT`, `CAPTURE` -> paid
  - `PENDING`, `INITIATED` -> pending
  - `EXPIRED`, `TIMEOUT` -> expired
  - `FAILED`, `FAILURE`, `DENIED`, `DENY`, `REJECTED` -> failed
  - `CANCELLED`, `CANCELED`, `CANCEL` -> cancelled
- Unknown status disimpan sebagai warning dan tidak mengaktifkan membership.
- Duplicate paid webhook harus idempotent dan tidak memproses bonus dua kali.
- Failed webhook setelah paid tidak boleh membalik invoice paid.

## Logging Aman

Logging production harus aman:

- `req.headers.authorization` diredact.
- `req.headers.signature` diredact.
- `req.headers.client-id` diredact.
- Token, secret, API key, password, snap token, dan signature diredact.
- Raw gateway response disimpan lewat sanitasi yang meredact secret/signature/token/authorization/API key/private key.

Untuk capture payload UAT/troubleshooting, gunakan script lokal:

```bash
npm --workspace apps/backend run doku:capture-webhook
```

Atau:

```bash
DOKU_CAPTURE_PORT=5055 \
DOKU_CAPTURE_DIR=doku-webhook-captures \
npm --workspace apps/backend run doku:capture-webhook
```

Folder `doku-webhook-captures/` sudah di-ignore Git. Jangan commit hasil capture.

## UAT Webhook Production Flow

| Step | Expected Result |
| --- | --- |
| Deploy backend manual ke VPS | API health PASS |
| Set DOKU webhook URL | Dashboard DOKU tersimpan ke `https://api.tapgolion.id/api/v1/webhooks/doku` |
| Buat order test nominal kecil | Order/invoice PENDING, nominal disetujui owner |
| Create DOKU payment | `paymentUrl` keluar |
| Buka paymentUrl | Checkout page DOKU terbuka |
| User membayar nominal kecil | Payment success di DOKU |
| Webhook diterima backend | HTTP 200 dari `/api/v1/webhooks/doku` |
| Signature valid | Tidak ada `DOKU_SIGNATURE_INVALID` |
| Invoice menjadi PAID | Invoice/order status paid |
| Membership aktif | User membership berubah sesuai order |
| Bonus/referral tidak double | Ledger/bonus hanya sekali |
| Duplicate webhook | Tetap idempotent |
| Admin report | Payment gateway DOKU terlihat di history/report |

## Smoke Test Setelah Deploy

```bash
curl -sS https://api.tapgolion.id/health
```

Expected:

```json
{
  "success": true,
  "status": "ok"
}
```

Cek log webhook saat UAT:

```bash
pm2 logs tapgo-api --lines 200
```

Cari:

- request ke `/api/v1/webhooks/doku`
- status HTTP 200
- tidak ada `DOKU_SIGNATURE_INVALID`
- tidak ada secret/signature/token tercetak jelas

## Rollback Jika Webhook Gagal

### Jika deploy backend gagal

```bash
cd /var/www/Tapgo
git log --oneline -5
git checkout <PREVIOUS_GOOD_COMMIT>
npm ci
npm --workspace apps/backend run build
pm2 restart tapgo-api --update-env
pm2 save
curl -sS https://api.tapgolion.id/health
```

### Jika webhook gagal signature

1. Jangan retry pembayaran besar.
2. Pastikan dashboard DOKU memakai URL canonical.
3. Pastikan `DOKU_CLIENT_ID` dan `DOKU_SECRET_KEY` adalah credential production yang sama dengan create payment.
4. Jika DOKU memberi webhook secret khusus, isi `DOKU_WEBHOOK_SECRET`.
5. Restart backend:

```bash
pm2 restart tapgo-api --update-env
```

6. Ulang test notification atau transaksi kecil.

### Jika invoice tidak berubah paid

1. Cek invoice number/reference ID yang dikirim DOKU.
2. Cek apakah invoice ada di DB production.
3. Jangan mark paid manual kecuali sudah ada bukti transaksi valid dan approval owner.
4. Simpan payload sanitized untuk analisis.

### Jika bonus/referral dobel

1. Stop UAT transaksi berikutnya.
2. Jangan approve withdrawal dari ledger terkait.
3. Audit invoice, payment, wallet transaction, dan bonus reference.
4. Rollback source hanya jika bug berasal dari kode deploy terbaru.
5. Koreksi ledger hanya lewat prosedur reversal/approval owner.

## Risiko Tersisa

- Belum ada nominal kecil production yang aman jika semua paket membership tetap mulai dari Rp500.000.
- Jika memakai production credential, transaksi sungguhan dapat terjadi saat paymentUrl dibayar.
- Webhook signature production harus dikonfirmasi terhadap payload asli DOKU.
- Jika `DOKU_WEBHOOK_SECRET` berbeda dari `DOKU_SECRET_KEY`, webhook akan gagal sampai secret khusus diisi.
- Payment channel DOKU harus aktif untuk merchant TapGo.
- UAT production wajib memakai user/order internal yang disetujui owner.

## Go / No-Go

GO untuk deploy manual backend dan set webhook hanya jika:

- Backup VPS dan DB production sudah dibuat.
- Source backend DOKU checkout sudah ada di VPS.
- `.env` production sudah benar.
- Owner menyetujui skenario nominal kecil.
- DOKU payment channel aktif.
- Tim siap memonitor `pm2 logs`.

NO-GO jika:

- Belum ada nominal kecil yang aman.
- Credential production belum final.
- Webhook secret belum jelas dan DOKU tidak menyediakan test notification.
- Owner belum approve transaksi production test.
