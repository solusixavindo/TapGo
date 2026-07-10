# DOKU Checkout Integration Hardening Report

Tanggal: 2026-07-01

## Executive Summary

Integrasi DOKU TapGo sudah dikunci untuk mode `checkout`.

Keputusan final tahap pertama:

- Gateway utama: DOKU
- Mode aktif: `DOKU_INTEGRATION_MODE=checkout`
- Direct API / SNAP Direct: disiapkan sebagai future mode dan sengaja tidak aktif.
- Backend memakai `DOKU_ENABLED`, bukan `NEXT_PUBLIC_DOKU_ENABLED`.
- Canonical create payment: `POST /api/v1/payments/doku/create`
- Canonical webhook: `POST /api/v1/webhooks/doku`
- Production webhook URL: `https://api.tapgolion.id/api/v1/webhooks/doku`

Tidak ada deploy, tidak ada migration, tidak ada production DB change, dan Midtrans flow lama tidak dihapus.

## File yang Diubah/Ditambahkan

Backend:

- `apps/backend/.env.example`
- `apps/backend/.env.production.example`
- `apps/backend/src/app.ts`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/core/logger/logger.ts`
- `apps/backend/src/lib/doku/config.ts`
- `apps/backend/src/lib/doku/client.ts`
- `apps/backend/src/lib/doku/signature.ts`
- `apps/backend/src/lib/doku/types.ts`
- `apps/backend/src/modules/memberships/presentation/membership-order.controller.ts`
- `apps/backend/src/modules/memberships/presentation/membership-order.routes.ts`
- `apps/backend/src/modules/payments/application/DokuPaymentService.ts`
- `apps/backend/src/modules/payments/presentation/doku.controller.ts`
- `apps/backend/src/modules/payments/presentation/doku.routes.ts`
- `apps/backend/src/modules/payments/presentation/doku.validators.ts`
- `apps/backend/tests/payments/doku.unit.test.ts`
- `apps/backend/tests/payments/doku.integration.test.ts`

Flutter user app:

- `apps/user_app/lib/screens/payment_demo_screen.dart`
- `apps/user_app/lib/screens/admin_payment_screen.dart`
- `apps/user_app/lib/data/demo_admin_data.dart`
- `apps/user_app/lib/services/tapgo_api_client.dart`

Dokumentasi:

- `DOKU_SETUP.md`
- `DOKU_PAYMENT_INTEGRATION_REPORT.md`

## Endpoint Final

Canonical:

- `POST /api/v1/payments/doku/create`
- `POST /api/v1/webhooks/doku`
- `GET /api/v1/payments/doku/status/:referenceId`

Alias kompatibilitas:

- `POST /api/payments/doku/create`
- `POST /api/webhooks/doku`

Alias hanya untuk kompatibilitas sandbox/tes lama. Dokumentasi production memakai `/api/v1/*`.

## Env Final

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

`NEXT_PUBLIC_DOKU_ENABLED` tidak lagi dipakai backend.

## Hardening yang Dilakukan

- Mode DOKU dikunci ke `checkout`.
- `snap_direct` menghasilkan error aman `DOKU_MODE_NOT_SUPPORTED`.
- Create payment selalu mengambil amount, customer, invoice, dan package dari database.
- `orderId` tetap dilindungi auth dan ownership check.
- Admin/Super Admin tetap bisa membaca order sesuai guard existing.
- Webhook memakai signature headers DOKU.
- Signature dapat memakai raw request body dari Express.
- Missing header, invalid signature, dan payload berubah ditolak.
- `expiredAt` memakai DOKU response atau default 24 jam ISO timestamp.
- Unknown status tidak mengaktifkan membership.
- Failed/expired/cancelled setelah paid tidak mengubah invoice paid karena update terminal hanya berlaku untuk invoice/order `PENDING`.
- Raw gateway payload disimpan dalam metadata dengan redaksi secret/signature/token/authorization/private key.
- Logger meredaksi signature, token, API key, secret.

## Mapping Status DOKU

- `SUCCESS`, `PAID`, `SETTLEMENT`, `CAPTURE` -> `PAID`
- `PENDING`, `INITIATED` -> `PENDING`
- `EXPIRED`, `TIMEOUT` -> `EXPIRED`
- `CANCELLED`, `CANCELED`, `CANCEL` -> `CANCELLED`
- `FAILED`, `FAILURE`, `DENIED`, `DENY`, `REJECTED` -> `FAILED`
- Unknown -> dicatat sebagai metadata, tidak mengaktifkan membership

## Manual Fallback

Jika create DOKU payment gagal:

- Invoice tetap `PENDING`.
- Membership tidak aktif.
- Bonus tidak diproses.
- User melihat error umum di app.
- Admin dapat retry create payment/check status.
- Midtrans/manual flow lama tidak dihapus.

## Admin UI

Admin payment screen mengambil invoice dari provider backend production. Demo fallback hanya aktif untuk development build. Untuk payment provider `DOKU`, detail invoice menampilkan reference ID dan tombol `Check DOKU Status`.

## Validasi

PASS:

- `npm --workspace apps/backend run build`
- `npm --workspace apps/backend run test`
- `DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5432/tapgo?schema=public npx prisma validate --schema apps/backend/prisma/schema.prisma`
- `flutter analyze`
- `flutter test`

Catatan:

- Integration test DOKU idempotency sudah ditambahkan dan akan berjalan saat `TAPGO_TEST_DATABASE_URL` tersedia.
- Pada shell ini integration DB tidak aktif, sehingga test integration tetap skip seperti test integration lain.

## Risiko Tersisa

- Perlu uji sandbox dengan credential DOKU asli.
- Perlu capture payload webhook asli DOKU dari dashboard sandbox untuk memastikan field status/reference sama dengan mapping.
- `snap_direct` belum boleh diaktifkan sampai endpoint resmi SNAP Direct diimplementasikan dan diuji penuh.
