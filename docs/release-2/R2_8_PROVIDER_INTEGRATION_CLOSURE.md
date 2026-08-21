# R2.8 — Real Provider Integration (Digiflazz): Implementation Closure

Tanggal: 21 Agustus 2026
Branch: `agent/tapgo-release2-ppob-provider` (menumpuk di atas R2.7 `0785cf3`)

## Ringkasan

Stage R2.8 menyambungkan domain PPOB ke provider nyata pertama, **Digiflazz**,
tanpa mengubah satu baris pun alur aman-uang yang dikunci pada R2.7. Yang
ditambahkan:

1. **Adapter `DigiflazzPpobProvider`** — implementasi `PpobProviderGateway`
   sesuai kontrak resmi developer.digiflazz.com (topup sinkron + cek status
   dengan ref_id yang sama).
2. **Webhook Digiflazz** — `POST /api/v1/webhooks/ppob/digiflazz` dengan
   verifikasi HMAC-SHA1 pada raw body (`X-Hub-Signature`), finalisasi
   idempoten, dan jawaban yang tidak pernah memicu retry tanpa akhir.
3. **Worker rekonsiliasi** — siklus berkala (fail-closed, default mati) yang
   men-eskala PENDING yatim dan mengecek status PROCESSING ke provider,
   dijaga `pg_try_advisory_xact_lock` antar-instance.
4. **`providerSku`** pada katalog — kode produk sisi provider terpisah dari
   sku internal; bila kosong, sku internal dipakai apa adanya.

## Kontrak Digiflazz yang Diimplementasikan

| Aspek | Kontrak | Implementasi |
|---|---|---|
| Endpoint | `POST {baseUrl}/transaction` | `callTransaction()` |
| Signature request | `md5(username + apiKey + ref_id)` | `digiflazzSign()` — golden-vector tested |
| Dedup provider | `ref_id` unik; topup ulang ref_id sama tidak memotong saldo dua kali | `ref_id = publicReference` kita |
| Cek status pending | topup ulang dengan payload identik | `checkStatus()` = payload yang sama |
| Respons | `{ data: { status: Sukses/Pending/Gagal, rc, sn, ... } }` | `mapDigiflazzStatus()` — status asing dilempar, tidak pernah ditebak sukses |
| Mode uji | `testing: true` tanpa memotong saldo nyata | SELALU aktif di luar production |
| Webhook | `X-Hub-Signature: sha1=<HMAC-SHA1(rawBody, secret)>` | verifikasi `timingSafeEqual` pada rawBody tangkapan parser global |

## Jaminan (mewarisi dan memperluas R2.7)

- **Saldo provider tidak terpotong dua kali** — ref_id stabil per transaksi.
- **Refund tetap tepat satu kali** — webhook ganda, webhook+worker bersamaan,
  dan replay semuanya melalui `finalizePurchase` yang dijaga transisi bersyarat.
- **Webhook tidak dapat dipalsukan** — tanpa secret, 401; payload yang diubah
  setelah ditandatangani, 401; secret belum dikonfigurasi, 503 (fail-closed).
- **PENDING yatim pulih sendiri** — worker men-eskala dan meng-inquiry;
  jawaban Gagal merefund, jawaban Sukses mem-finalkan, error jaringan dicoba
  ulang siklus berikutnya tanpa mengubah status.
- **Webhook "create" yang tiba sebelum jawaban API** di-defer (bukan menimpa
  outcome otoritatif jawaban API); provider mengirim "update"/retry.

## File Baru / Berubah

```
apps/backend/prisma/migrations/20260821030000_ppob_provider_sku/   (baru)
apps/backend/prisma/schema.prisma          + providerSku pada PpobProduct
apps/backend/src/modules/ppob/domain/ppobProvider.ts    + checkStatus, providerSku
apps/backend/src/modules/ppob/domain/PpobRepository.ts  + 4 metode rekonsiliasi/webhook
apps/backend/src/modules/ppob/application/PpobService.ts + finalizeFromProviderNotification, reconcileOpenTransactions
apps/backend/src/modules/ppob/infrastructure/DigiflazzPpobProvider.ts  (baru)
apps/backend/src/modules/ppob/infrastructure/PrismaPpobRepository.ts   + implementasi metode baru
apps/backend/src/modules/ppob/presentation/digiflazz-webhook.routes.ts (baru)
apps/backend/src/modules/ppob/presentation/ppob.routes.ts             resolver + digiflazz
apps/backend/src/app.ts                 mount /api/v1/webhooks/ppob
apps/backend/src/server.ts              worker rekonsiliasi fail-closed
apps/backend/src/config/env.ts          + 7 env var terdokumentasi
apps/backend/.env*.example              + dokumentasi var
apps/backend/tests/ppob/digiflazzProvider.test.ts       (baru, 7 test)
apps/backend/tests/ppob/digiflazz.integration.test.ts   (baru, 9 test)
```

## Bukti Test

| Lapis | Hasil |
|---|---|
| Unit adapter (sign golden vector, pemetaan status, fail-closed status asing) | 7/7 PASS |
| Integrasi (stub HTTP server nyata): kontrak payload provider, gagal+refund, webhook finalisasi, webhook ganda idempoten, webhook gagal refund 1×, signature salah/ubah-payload 401, ref tak dikenal 200 ignored, rekonsiliasi PROCESSING→SUCCESS, PENDING yatim→eskalasi→FAILED+refund, advisory lock | 9/9 PASS |
| Regresi PPOB R2.7 | 17/17 PASS |
| Full suite backend | **766/766 PASS** (65 files) |
| ESLint + `tsc` build | 0 issue · PASS |
| Smoke runtime (server nyata + stub Digiflazz): purchase → payload provider terverifikasi (buyer_sku_code=tsel10, testing=true, sign md5 valid) → SUCCESS + serial; webhook valid → already-final; webhook signature salah → 401 | PASS |

## Aktivasi Produksi (langkah manual owner)

1. Isi `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY` dari panel Digiflazz
   (Atur Koneksi > API); daftarkan IP server.
2. Set webhook `https://api.tapgolion.id/api/v1/webhooks/ppob/digiflazz` dengan
   secret sendiri, isi `DIGIFLAZZ_WEBHOOK_SECRET`.
3. Isi `provider_sku` katalog dengan `buyer_sku_code` hasil setting di panel.
4. UAT sandbox: `PPOB_PROVIDER=digiflazz` + `DIGIFLAZZ_TESTING=true`.
5. Setelah UAT lulus: `PPOB_RECONCILE_ENABLED=true`, `DIGIFLAZZ_TESTING=false`.

## Limitasi (kejujuran)

- **UAT dengan kredensial Digiflazz nyata belum dilakukan** — butuh akun
  buyer dan deposit; status stage ini: kode + kontrak + test lengkap, UAT
  production menunggu kredensial (sama seperti posisi DOKU pada R1).
- Postpaid (PLN_PASCA/BPJS inquiry) tetap nonaktif — butuh alur inquiry
  terpisah (`inq-pasca`/`pay-pasca`), dicadangkan untuk stage berikutnya.
- Customer UI tidak berubah pada stage ini (backend-only).
