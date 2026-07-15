# Founder Chairman Implementation Report

Tanggal: 2026-07-16

## Ringkasan

Founder Chairman sudah divalidasi sebagai posisi tunggal tertinggi dalam Founder Program TapGo. Akun ini efektif sebagai Platinum aktif, tetapi diberikan gratis sebagai akun penghormatan dan bukan transaksi pembelian.

Status akhir: **GO FOR MERGE**.

## Aturan Bisnis

- Maksimal 1 akun Founder Chairman.
- Founder ID resmi: `FCH-001`.
- Tidak termasuk kuota 10 Founder Platinum.
- Membership efektif: Platinum `ACTIVE`.
- Tidak membuat membership order, invoice, payment, atau revenue.
- Tidak memberi PPOB benefit otomatis.
- Wallet awal `cashBalance = 0` dan `ppobBalance = 0`.
- Grant tidak memicu sponsor bonus, level bonus, reward, profit sharing, atau revenue.
- Akun `ACTIVE` tetap boleh menjadi sponsor dan menerima bonus dari downline yang membayar membership valid.
- Akun `SUSPENDED` atau `REVOKED` tidak menerima bonus baru.
- Tidak ada endpoint delete.

## Backend

Endpoint baru, seluruhnya `SUPER_ADMIN` only:

- `POST /api/v1/admin/founder-chairman/grant`
- `GET /api/v1/admin/founder-chairman`
- `GET /api/v1/admin/founder-chairman/:founderId`
- `PATCH /api/v1/admin/founder-chairman/:founderId/status`

Attempt grant kedua ditolak dengan:

```text
FOUNDER_CHAIRMAN_ALREADY_EXISTS
```

Grant Founder Chairman sekarang menjalankan transaksi serializable dan memetakan konflik Prisma `P2002`/`P2034` menjadi response bisnis `FOUNDER_CHAIRMAN_ALREADY_EXISTS`, termasuk saat dua request grant berjalan bersamaan.

## Data Sensitif Rekening

Nomor rekening tidak di-hardcode di source code, tidak ditulis ke dokumentasi publik, dan tidak dicetak penuh dalam response. Seed script membaca rekening hanya dari environment lokal:

- `FOUNDER_CHAIRMAN_BANK_NAME`
- `FOUNDER_CHAIRMAN_BANK_ACCOUNT_NAME`
- `FOUNDER_CHAIRMAN_BANK_ACCOUNT_NUMBER`

Response admin hanya menampilkan `bankAccountMasked`, contoh format `*********0123`. Validasi lokal memastikan nomor rekening penuh tidak muncul di response grant maupun metadata audit grant.

## Migration

Migration baru:

- `apps/backend/prisma/migrations/0015_founder_chairman_program/migration.sql`
- `apps/backend/prisma/migrations/0016_founder_chairman_unique_guard/migration.sql`

Perubahan:

- Menambah enum `FOUNDER_CHAIRMAN` pada `FounderRole`.
- Menambah unique partial index agar hanya ada satu grant Founder Chairman.

Root cause yang diperbaiki:

- Clean migrate sempat gagal pada migration `0016_founder_chairman_unique_guard` karena predicate index memakai cast `"founder_role"::text = 'FOUNDER_CHAIRMAN'`.
- PostgreSQL menolak predicate tersebut dengan error `42P17 functions in index predicate must be marked IMMUTABLE`.
- Predicate diperbaiki menjadi perbandingan enum native: `"founder_role" = 'FOUNDER_CHAIRMAN'::"FounderRole"`.

## Clean Migration Result

Database test kosong:

`tapgo_founder_chairman_clean`

Command:

```bash
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:55433/tapgo_founder_chairman_clean?schema=public \
npm --workspace apps/backend run db:deploy
```

Result: **PASS**.

Seluruh migration berhasil diterapkan dari awal sampai:

- `0014_founder_platinum_program`
- `0015_founder_chairman_program`
- `0016_founder_chairman_unique_guard`
- `20260524164345_member`

Tidak ada SQL manual sebagai workaround akhir.

## Upgrade Migration Result

Database upgrade test:

`tapgo_founder_chairman_upgrade`

Prosedur:

- Apply migration sampai `0014_founder_platinum_program` memakai Prisma migrate deploy dengan schema/migrations sementara untuk simulasi database existing.
- Seed 10 Founder Platinum di database upgrade.
- Jalankan `npm --workspace apps/backend run db:deploy` dari migration penuh untuk menerapkan `0015`, `0016`, dan migration setelahnya.

Result: **PASS**.

Regression Founder Platinum setelah upgrade:

- 10 Founder Platinum tetap ada.
- Founder ID `FND-001` sampai `FND-010` tetap utuh.
- Tidak ada Founder Chairman sebelum seed.
- Enum `FOUNDER_PLATINUM` existing tetap valid.
- Unique guard Founder Chairman aktif.

## Seed Founder Chairman Test Result

Database:

`tapgo_founder_chairman_clean`

Dry-run seed: **PASS**.

Execute seed test: **PASS**.

Verifikasi:

- Hanya 1 Founder Chairman.
- Founder ID `FCH-001`.
- Membership Platinum `ACTIVE`.
- `cashBalance = 0`.
- `ppobBalance = 0`.
- Tidak ada invoice.
- Tidak ada membership order.
- Tidak ada payment.
- Tidak ada revenue.
- Tidak ada PPOB benefit.
- Tidak ada bonus saat grant.
- Audit event `FOUNDER_CHAIRMAN_GRANTED` tercatat.
- Rekening hanya tampil masked.

Catatan:

- Seed script aman: default dry-run, execute hanya dengan `TAPGO_FOUNDER_CHAIRMAN_CONFIRM=YES`.
- Password dan rekening dibaca dari environment lokal ignored.
- Output laporan tidak menampilkan password atau nomor rekening penuh.

## Integration Test Result

Targeted Founder/Admin Console integration:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:55433/tapgo_founder_chairman_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:55433/tapgo_founder_chairman_test?schema=public \
npm --workspace apps/backend run test -- tests/admin-console/adminConsole.integration.test.ts
```

Result: **PASS**.

- 8 tests passed.
- 0 skipped.

Full backend test:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:55433/tapgo_founder_chairman_test?schema=public \
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:55433/tapgo_founder_chairman_test?schema=public \
npm --workspace apps/backend run test -- --reporter=dot
```

Result: **PASS**.

- 17 test files passed.
- 115 tests passed.
- 0 skipped.

Catatan runtime:

- Full integration test perlu dijalankan di luar sandbox karena test membuka server localhost dan mengakses PostgreSQL Docker lokal.
- Kegagalan sandbox sebelumnya berupa `listen EPERM 127.0.0.1` dan bukan kegagalan kode.

## Coverage Founder Chairman

Test yang tervalidasi:

- Grant pertama berhasil.
- Founder ID `FCH-001` benar.
- Membership Platinum aktif.
- Wallet Rp0/Rp0.
- Tidak ada invoice/payment/revenue.
- Grant tidak memicu bonus.
- Attempt grant kedua ditolak.
- Founder Chairman bisa menjadi sponsor.
- Founder Chairman menerima sponsor bonus dari downline paid valid.
- Founder Chairman menerima level bonus dari jaringan valid.
- Suspend menghentikan bonus baru.
- Reactivate mengaktifkan bonus kembali.
- Revoke menghentikan bonus baru.
- Reason wajib untuk suspend/revoke.
- USER dan ADMIN biasa ditolak.
- Hanya SUPER_ADMIN diizinkan.
- Tidak ada DELETE endpoint.
- Rekening selalu masked.
- 10 Founder Platinum existing tetap tidak berubah.

## Concurrency Guard Result

Test dua request grant simultan:

- Satu request berhasil `201`.
- Satu request ditolak `409`.
- Error code: `FOUNDER_CHAIRMAN_ALREADY_EXISTS`.
- Jumlah grant Founder Chairman di database tetap 1.
- Jumlah user dengan referral code `FCH-001` tetap 1.

Database-level guard:

- Partial unique index `founder_program_grants_one_chairman_key`.
- Predicate memakai enum native dan valid untuk PostgreSQL migrate deploy.

## Flutter/UI Validation

Command:

```bash
flutter analyze
flutter test
```

Result:

- `flutter analyze`: **PASS**, no issues found.
- `flutter test`: **PASS**, 8 tests passed.

Validasi UI:

- Badge Founder Chairman memiliki prioritas di atas Founder Platinum.
- Founder Platinum tetap memakai badge berbeda.
- User biasa tidak melihat admin-only Founder Program Console.
- Tidak ada flow delete Founder.

## Build and Prisma Validation

Command:

```bash
npm --workspace apps/backend run db:generate
npm --workspace apps/backend run build
npx prisma validate --schema apps/backend/prisma/schema.prisma
```

Result:

- Prisma generate: **PASS**.
- Backend build: **PASS**.
- Prisma validate: **PASS**.

## Keamanan PostgreSQL Lokal

Kondisi lokal:

- Port `5433` sedang dipakai container project lain, sehingga validasi Founder Chairman memakai container test terpisah `tapgo-founder-postgres` pada port `55433`.
- `pg_hba.conf` container `tapgo-postgres` yang sempat memakai konfigurasi test lokal sudah direstore dari backup.
- Tidak ada perubahan `pg_hba` production.
- Tidak ada production database yang disentuh.

## Regression Scope

Dinyatakan tidak berubah:

- 10 Founder Platinum existing.
- DOKU flow.
- Midtrans flow.
- Google Play readiness.
- Xendit tetap tidak digunakan di TapGo v1.0.

## Risiko Tersisa

- Production seed harus dijalankan manual oleh owner/operator setelah deployment backend dan migration production disetujui.
- Nomor rekening penuh hanya boleh dimasukkan melalui environment lokal aman atau admin form aman, tidak melalui Git atau dokumen publik.
- Jika production deploy memakai database existing, jalankan backup database sebelum `prisma migrate deploy`.

## Final Decision

**GO FOR MERGE**

Founder Chairman Program siap direview dan digabungkan setelah branch review, dengan catatan tidak menjalankan migration/seed production sebelum window deployment resmi dan backup production tersedia.

## Konfirmasi Batasan

- Tidak deploy.
- Tidak migration production.
- Tidak seed production.
- Tidak build/upload APK/AAB.
- Tidak upload Google Play.
- Tidak merge ke develop/main.
- Tidak commit password.
- Tidak commit nomor rekening.
- Tidak mengubah 10 Founder Platinum existing.
- Tidak mengubah DOKU/Midtrans.
- Tidak mengaktifkan Xendit.
