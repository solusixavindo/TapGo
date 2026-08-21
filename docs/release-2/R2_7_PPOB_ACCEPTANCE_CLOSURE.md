# R2.7 PPOB Foundation & Customer UI — Acceptance Closure

Tanggal: 21 Agustus 2026

## Ringkasan

Stage R2.7 membangun fondasi PPOB (Payment Point Online Banking) end-to-end: skema database, modul backend Clean Architecture, REST API customer, dan antarmuka customer di `user_app` — dengan provider biller yang sengaja **fail-closed** (`NoPpobProviderGateway`) karena integrasi provider nyata adalah scope Stage R2.8.

Keputusan scope yang disetujui Owner sebelum implementasi:

1. **Saldo gabungan** — pembelian PPOB menyerap `Wallet.ppobBalance` (saldo benefit) lebih dulu, sisanya dari `Wallet.balance` (saldo utama), dalam satu transaksi atomik.
2. **Kategori luas sejak fondasi** — 6 kategori di-seed: Pulsa, Paket Data, Token PLN, BPJS, PDAM, E-Money (18 produk).

Prinsip yang dijaga sepanjang stage:

- **Fail-closed**: tanpa provider, order dibuat sebagai `PROCESSING` lalu langsung ditolak provider dan `REFUNDED` dengan kompensasi ledger penuh. Saldo tidak pernah hilang; tidak ada order menggantung dalam status non-terminal.
- **Idempoten**: `idempotencyKey` unik per order; retry/replay mengembalikan order yang sama tanpa debit ganda (kode 201 untuk order baru, 200 untuk replay).
- **Anti-steering / Play-safe**: pembelian memakai saldo internal TapGo; nol tautan pembayaran eksternal, nol WebView, nol CTA keluar aplikasi.
- **Privacy**: endpoint hanya mengembalikan data milik pemanggil; akses silang dijawab 404 (bukan 403 yang membocorkan keberadaan data).

## Arsitektur Backend

| Area | File |
|---|---|
| Schema & migration | `apps/backend/prisma/schema.prisma` (`PpobCategory`, `PpobProduct`, `PpobOrder`, `PpobIdempotencyRecord`, enum `WalletTransactionType.PPOB_PURCHASE`/`PPOB_REFUND`), `apps/backend/prisma/migrations/20260821130000_ppob_foundation/migration.sql` |
| Domain | `apps/backend/src/modules/ppob/domain/ppobModels.ts`, `PpobRepository.ts`, `PpobProviderGateway.ts` (port batas R2.8) |
| Application | `apps/backend/src/modules/ppob/application/PpobCatalogService.ts`, `PpobOrderService.ts` |
| Infrastructure | `apps/backend/src/modules/ppob/infrastructure/PrismaPpobRepository.ts`, `NoPpobProviderGateway.ts` |
| Presentation | `apps/backend/src/modules/ppob/presentation/ppob.routes.ts`, `ppob.controller.ts`, `ppob.validators.ts` |
| Wiring | `apps/backend/src/app.ts` (`/api/v1/ppob`), `apps/backend/prisma/seed.ts` (katalog 6 kategori/18 produk) |

Endpoint (semua `requireAuth`):

| Method & Path | Fungsi |
|---|---|
| `GET /api/v1/ppob/catalog` | Kategori + produk aktif |
| `POST /api/v1/ppob/orders/inquiry` | Validasi pola nomor tujuan + rincian saldo gabungan (tanpa menggerakkan dana) |
| `POST /api/v1/ppob/orders` | Buat order atomik (debit → provider fail-closed → kompensasi refund) |
| `GET /api/v1/ppob/orders` | Riwayat order milik pemanggil |
| `GET /api/v1/ppob/orders/:id` | Detail order milik pemanggil (404 bila bukan pemilik) |

## Arsitektur Customer UI (`apps/user_app`)

Modul fitur berdiri sendiri (bukan `part of` — blueprint modernisasi user_app mengikuti pola driver_app):

| Area | File |
|---|---|
| Domain model | `lib/features/ppob/domain/ppob_models.dart` |
| Repository (port typedef wire) | `lib/features/ppob/data/ppob_repository.dart` |
| Demo repository (nol network) | `lib/features/ppob/data/ppob_demo_repository.dart` |
| Riverpod providers | `lib/features/ppob/application/ppob_providers.dart` |
| Layar | `lib/features/ppob/presentation/ppob_home_screen.dart`, `ppob_category_screen.dart`, `ppob_checkout_screen.dart`, `ppob_history_screen.dart`, `widgets/ppob_shared.dart` |
| Jembatan bootstrap | `apps/user_app/lib/main.dart` (`_buildPpobRepository`, override `ppobRepositoryProvider`, flag `TAPGO_PPOB_DEMO_MODE`) |
| Entry point dashboard | `apps/user_app/lib/screens/dashboard_screen.dart` (tile `PPOB` pada grid Play; `Pulsa`/`PPOB` pada direct) |

Single-flight di layar checkout: selama satu permintaan berjalan tombol terkunci; idempotency key dibuat sekali per layar sehingga retry dikenali server sebagai replay.

## Bukti Uji

### Backend — `apps/backend`

- Unit: `tests/ppob/ppobOrderService.unit.test.ts` — **14/14 PASS** (saldo gabungan, benefit-only, main-only, insufficient, pola target per kategori, idempotency replay, konflik payload, fail-closed kompensasi penuh, P2002 race → replay).
- Integrasi HTTP: `tests/ppob/ppob.integration.test.ts` — **11/11 PASS** (katalog, 401 tanpa auth, inquiry, target invalid, order fail-closed REFUNDED + saldo kembali penuh + ledger konsisten, replay 200, konflik 409, isolasi privasi antar-user 404).
- **Full suite: 63 file / 758 test PASS** — nol regresi pada modul lain (termasuk wallets & payments yang berbagi harness).

### Customer UI — `apps/user_app`

- Widget test: `test/ppob_customer_test.dart` — **14/14 PASS** (accepted, empty, error+retry, 320dp+dark, breakdown saldo gabungan, saldo tidak cukup tombol nonaktif, provider unavailable, single-flight double-tap = 1 order, reset inquiry saat nomor berubah, privacy tanpa token/PII, riwayat accepted/empty/error).
- **Full suite: 177 test PASS** (34 skip = golden visual yang sengaja digerbang dart-define).
- `flutter analyze` — **0 issue** (termasuk perbaikan kompatibilitas `SizeTransition.axisAlignment` pada `lib/widgets/referral_tree_node_widget.dart` yang sebelumnya gagal-kompilasi pada Flutter 3.35; perubahan setara top-center, tanpa perubahan perilaku).

## Bukti Visual

Lokasi: `docs/release-2/visual-review/r2.7-ppob/`

| File | State |
|---|---|
| `01_ppob_home_catalog.png` | Beranda PPOB — grid 6 kategori |
| `02_ppob_category_pulsa.png` | Daftar nominal produk |
| `03_ppob_checkout_form.png` | Form nomor tujuan |
| `04_ppob_checkout_breakdown.png` | Rincian saldo gabungan (benefit + utama) |
| `05_ppob_checkout_result_refunded.png` | Hasil fail-closed: REFUNDED + dana kembali penuh |
| `06_ppob_checkout_insufficient.png` | Saldo tidak cukup — tombol bayar nonaktif |
| `07_ppob_history.png` | Riwayat dengan chip status |
| `08_ppob_history_empty.png` | Riwayat kosong |
| `09_ppob_home_dark.png` | Tema gelap — beranda |
| `10_ppob_checkout_breakdown_dark.png` | Tema gelap — rincian |
| `11_ppob_home_320dp.png` | Lebar 320 dp — tanpa overflow |
| `12_ppob_checkout_320dp.png` | Lebar 320 dp — checkout |
| `13_ppob_home_error.png` | Kegagalan katalog + coba lagi |
| `R2_7_PPOB_CONTACT_SHEET.png` | Contact sheet |

Semua tangkapan dirender dari widget produksi via `test/ppob_visual_evidence_test.dart` (font asli Flutter SDK, tema aplikasi sesungguhnya, penjaga anti-overflow aktif di setiap shot). Reproduksi:

```bash
cd apps/user_app
flutter test test/ppob_visual_evidence_test.dart \
  --dart-define=TAPGO_PPOB_VISUAL=true --update-goldens
```

## Acceptance Traceability

| No | Item acceptance | Bukti | Status |
|---:|---|---|---|
| 1 | Katalog 6 kategori luas tersedia dari backend | `ppob.integration.test.ts` (katalog 6 kategori, 18 produk); screenshot 01 | PASS |
| 2 | Saldo gabungan: benefit dulu, fallback utama | unit `debit gabungan`; screenshot 04 | PASS |
| 3 | Inquiry tidak menggerakkan dana | integrasi `inquiry hanya membaca` | PASS |
| 4 | Validasi pola nomor tujuan per produk | unit + integrasi `PPOB_TARGET_INVALID` | PASS |
| 5 | Idempotency: replay tanpa debit ganda (200) | integrasi `replay`; unit `idempoten` | PASS |
| 6 | Konflik idempotency (payload beda) → 409 | unit + integrasi | PASS |
| 7 | Fail-closed: tanpa provider, REFUNDED + saldo kembali penuh + ledger konsisten | integrasi `fail-closed`; screenshot 05 | PASS |
| 8 | Saldo tidak cukup → 402, tanpa order tercipta | integrasi `insufficient`; screenshot 06 | PASS |
| 9 | Privasi: order orang lain tidak bocor (404) | integrasi `privacy` | PASS |
| 10 | Anti-steering: tanpa tautan/WebView/CTA keluar | widget test `find.textContaining('http') findsNothing`; copy layar | PASS |
| 11 | Single-flight di UI (double-tap = 1 order) | widget test `single-flight` | PASS |
| 12 | Dark mode + lebar 320 dp tanpa overflow | widget test; screenshot 09–12 (penjaga overflow) | PASS |
| 13 | Privacy UI: tanpa token/idempotency key ter-render | widget test `privacy` | PASS |
| 14 | Entry point Play-safe di grid dashboard | `widget_test.dart` (`Buka layanan PPOB` hadir pada distribusi Play) | PASS |

## Batasan yang Disengaja (handoff ke R2.8)

- **Provider nyata belum ada** — `NoPpobProviderGateway` selalu menolak; setiap order produksi berakhir `REFUNDED`. Ini perilaku yang BENAR untuk R2.7: lebih baik gagal jujur daripada menggantung dana.
- Status `PENDING`/`PROCESSING`/`SUCCESS` sudah dimodelkan dan diuji di lapisan domain, tetapi hanya akan muncul di produksi setelah R2.8 (provider asinkron + webhook/ polling settlement).
- Katalog saat ini di-seed statis; manajemen katalog via admin console adalah kandidat scope R2.9.

## Catatan Perubahan Insidental

- `lib/widgets/referral_tree_node_widget.dart`: `SizeTransition(alignment:)` → `axisAlignment: -1.0` — perbaikan kompatibilitas Flutter 3.35 (parameter `alignment` hanya ada di SDK lebih baru). Setara secara visual (top-center). Tanpa perbaikan ini seluruh suite test user_app tidak dapat dikompilasi di environment CI saat ini.
- `test/widget_test.dart`: ekspektasi grid Play diperbarui — tile `PPOB` kini SAH pada distribusi Play (pembayaran layanan dunia nyata via saldo internal; kategori yang dikecualikan dari kewajiban Play Billing).
