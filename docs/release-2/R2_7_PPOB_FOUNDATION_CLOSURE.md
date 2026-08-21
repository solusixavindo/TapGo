# R2.7 — PPOB Foundation & Customer UI: Implementation Closure

Tanggal: 21 Agustus 2026

## Ringkasan

Stage R2.7 menutup dua lingkup:

1. **Backend foundation PPOB** — modul `ppob` baru dengan Clean Architecture
   (domain/application/infrastructure/presentation), mengunci katalog produk,
   alur pembelian aman-uang, debit saldo PPOB & Benefit (`ppobBalance`),
   ledger `PPOB_PURCHASE`/`PPOB_REFUND`, idempotency, kompensasi refund penuh,
   dan provider port yang siap diganti adapter nyata pada R2.8.
2. **Customer UI** — alur PPOB lengkap di aplikasi customer (katalog, filter
   kategori, checkout, hasil, riwayat, detail) pada distribusi **direct**.

Tidak ada perubahan pada payment gateway (DOKU/Midtrans), skema membership,
ride domain, driver app, admin dashboard, konfigurasi produksi, maupun
artifact release.

## Batasan Keputusan

| Keputusan | Alasan |
|---|---|
| Provider nyata TIDAK diintegrasikan | Ruang lingkup R2.8. Port `PpobProviderGateway` dibekukan; hari ini hanya ada adapter `stub` (deterministik) dan `disabled` (fail-closed). |
| `PPOB_PROVIDER` default `disabled` | Fail-closed mengikuti tradisi flag TapGo (`DOKU_ENABLED`, `REALTIME_ENABLED`). Pembelian dibatalkan dengan refund penuh + `503 PPOB_PROVIDER_DISABLED`. Nilai tak dikenal menggagalkan boot lewat Zod enum. |
| Pembelian hanya mendebit `ppobBalance` | `ppobBalance` adalah bucket benefit non-withdrawable (dibuktikan `ppobWalletSeparation.integration.test.ts`). `balance`/`cashBalance` tidak disentuh. |
| Surface aplikasi Play TIDAK berubah | Menu PPOB hanya aktif pada distribusi direct. Penambahan menu pada build Play adalah keputusan Stage R2.9, sama seperti pembelian membership yang ditahan dari kanal app (`MEMBERSHIP_PURCHASE_APP_ENABLED=false`). |
| Produk pascabayar (PLN_POSTPAID, BPJS) di-seed nonaktif | Harga tagihan memerlukan inquiry ke provider nyata (R2.8). Menjual tanpa harga nyata adalah kebohongan UI. |
| Tanpa endpoint admin | Unified Admin adalah ruang lingkup R2.9. |

## Arsitektur Backend

```
POST /api/v1/ppob/transactions
  → validateRequest (zod)
  → PpobService.purchase
      1. getProductForPurchase (404 PPOB_PRODUCT_NOT_FOUND)
      2. normalizePpobTarget (400 PPOB_TARGET_INVALID) — normalisasi +62/62/0 → 08
      3. idempotency check (200 replay / 409 PPOB_IDEMPOTENCY_CONFLICT)
      4. tx serializable: wallet.updateMany bersyarat (400 INSUFFICIENT_PPOB_BALANCE)
         + ledger PPOB_PURCHASE + transaksi PENDING          [commit]
      5. provider.purchase → finalizePurchase:
         SUCCESS (serial/token) | FAILED → refund penuh + ledger PPOB_REFUND
         provider throw → FAILED(PROVIDER_ERROR) + refund
         provider disabled → FAILED(PROVIDER_DISABLED) + refund + 503
```

Jaminan aman-uang:

- **Tidak ada debit ganda**: `@@unique([userId, idempotencyKey])` + penanganan
  race P2002 (yang kalah balapan mengambil transaksi pemenang).
- **Tidak ada refund ganda**: transisi `updateMany` bersyarat status non-final
  + cek ledger `PPOB_REFUND` sebelum mengembalikan saldo.
- **Tidak ada saldo negatif**: debit bersyarat dalam satu statement di bawah
  row lock.
- **Tidak ada status sukses tanpa bukti**: proses mati antara langkah 4 dan 5
  meninggalkan transaksi `PENDING` yang dapat direkonsiliasi (worker R2.8
  memakai ulang `dispatchToProvider`).

## Inventaris Endpoint

| Method | Path | Auth | Rate limit | Deskripsi |
|---|---|---|---|---|
| GET | `/api/v1/ppob/products?category=` | user | api | Katalog aktif, terfilter kategori |
| POST | `/api/v1/ppob/transactions` | user | payment | Pembelian (Idempotency-Key opsional) |
| GET | `/api/v1/ppob/transactions?limit=` | user | api | Riwayat milik sendiri (maks 50) |
| GET | `/api/v1/ppob/transactions/:reference` | user | api | Detail milik sendiri; milik orang lain → 404 |

Error code: `PPOB_PRODUCT_NOT_FOUND` (404) · `PPOB_TARGET_INVALID` (400) ·
`INSUFFICIENT_PPOB_BALANCE` (400) · `PPOB_IDEMPOTENCY_CONFLICT` (409) ·
`PPOB_PROVIDER_DISABLED` (503) · `PPOB_TRANSACTION_NOT_FOUND` (404).

## Skema Database (migration `20260821013849_ppob_foundation`)

- Enum `PpobCategory` (PULSA, DATA, PLN_PREPAID, PLN_POSTPAID, BPJS, EWALLET)
- Enum `PpobTransactionStatus` (PENDING, PROCESSING, SUCCESS, FAILED, REFUNDED)
- `ppob_products` (sku unik, harga + adminFee, isActive, sortOrder)
- `ppob_transactions` (publicReference `PPB-XXXXXXXXXX`, snapshot produk,
  target ternormalisasi, idempotency key unik per user, tautan ledger)
- `WalletTransactionType` += `PPOB_PURCHASE`, `PPOB_REFUND`
- **Catatan drift**: output mentah `migrate dev` memuat `DROP DEFAULT` pada 18
  tabel lama (drift pre-existing antara migration hand-written dan schema).
  Pernyataan itu dibuang; migration final murni additive. Rollback: drop dua
  tabel + dua enum baru; nilai enum WalletTransactionType baru tidak dapat
  di-drop — forward-fix bila diperlukan.

Katalog seed (`prisma/seed.ts`, idempotent via upsert): 14 produk aktif
(Pulsa Telkomsel/XL, Data, Token PLN, GoPay, OVO) + 2 produk nonaktif
(PLN Pascabayar, BPJS — menunggu inquiry provider R2.8).

## Customer UI

File: `lib/screens/ppob_screens.dart` (baru), method API pada
`tapgo_api_client.dart`, hook test pada `main.dart`, wiring satu label
`'Pulsa'` pada `_tapGoServiceActionFor` (direct saja).

Konvensi yang dijaga: nol HTTP di `build`; single-flight pada tombol bayar;
Idempotency-Key dibuat sekali per checkout dan stabil saat retry; pesan error
ramah dari kode server (`tapGoPpobErrorMessage`); skeleton loading; empty dan
error state jujur; dark mode via `Theme.colorScheme`; reuse `RideNoticeCard`.

## Bukti Test

| Lapis | File | Hasil |
|---|---|---|
| Unit backend | `tests/ppob/ppobTargetValidation.test.ts` | 6/6 PASS |
| Integrasi backend | `tests/ppob/ppob.integration.test.ts` | 11/11 PASS |
| Full suite backend | 63 files | **750/750 PASS** |
| ESLint backend | `src/**` | 0 issue |
| Build backend | `tsc -p tsconfig.json` | PASS |
| Migration | deploy pada DB kosong | PASS |
| Seed | runtime ke Postgres nyata | PASS (16 SKU) |
| Widget test Flutter | `test/ppob_customer_test.dart` | 14/14 PASS |
| Entry direct | `test/ppob_direct_entry_test.dart --dart-define=TAPGO_DISTRIBUTION=direct` | 1/1 PASS |
| Full suite Flutter | `flutter test` | **177 PASS, 35 skipped** (skipped = test ber-flag compile-time, pre-existing) |
| `flutter analyze` | user_app | 0 issue |

Skenario integrasi kunci yang terbukti lewat HTTP nyata (bukan mock):
debit sekali + ledger lengkap + serial deterministik; replay idempotency 200
tanpa debit kedua; konflik key 409; saldo kurang 400 tanpa sisa baris; target
invalid 400; kegagalan sentinel → FAILED + refund penuh + replay tidak
refund ulang; isolasi kepemilikan 404; provider disabled → 503 + refund penuh
(diuji pada service+repository nyata).

## Limitasi (kejujuran)

- Adapter `stub` bersifat sinkron-sukses; status `PROCESSING` dicadangkan
  untuk fulfillment asinkron R2.8 dan belum punya jalur runtime.
- Screenshot runtime Android belum ada — lingkungan eksekusi stage ini tidak
  memiliki emulator; bukti visual Flutter berupa widget test + analyze.
  Screenshot mengikuti standar `VISUAL_EVIDENCE_STANDARD.md` §9.
- PLN Pascabayar/BPJS menunggu inquiry provider nyata (R2.8).
- Belum ada rekonsiliasi transaksi `PENDING` yatim (worker R2.8).

## Rollback

1. Flutter: revert commit — wiring `'Pulsa'` kembali ke `_showSoon`.
2. Backend: hapus mount `/api/v1/ppob` dari `app.ts`; tabel baru tidak dibaca
   modul lain sehingga aman dibiarkan atau di-drop manual.
3. Database: `DROP TABLE ppob_transactions, ppob_products; DROP TYPE
   PpobCategory, PpobTransactionStatus;` (nilai enum wallet baru dibiarkan —
   Postgres tidak dapat menghapus nilai enum; tidak dipakai baris lama).
