# Founder Platinum Program Implementation Report

Tanggal: 2026-07-09

## Ringkasan

Founder Platinum Program sudah diimplementasikan sebagai jalur admin khusus untuk membuat maksimal 10 akun penghormatan Founder Platinum.

Desain ini menjaga pemisahan finansial:

- Tidak membuat membership order.
- Tidak membuat invoice.
- Tidak membuat payment palsu.
- Tidak mencatat revenue.
- Tidak memberikan PPOB benefit otomatis.
- Wallet dibuat dengan `cashBalance = 0` dan `ppobBalance = 0`.

Founder Platinum tetap diperlakukan sebagai membership Platinum untuk referral, sponsor bonus, dan level bonus karena user memiliki active `UserMembership` tier `PLATINUM`.

Catatan rule final:

- Grant Founder Platinum adalah penghargaan gratis dan bukan transaksi pembelian.
- Grant tidak memicu sponsor bonus, level bonus, reward bonus, revenue, invoice, payment, atau PPOB benefit.
- Setelah akun aktif, Founder Platinum tetap dapat menjadi sponsor dan menerima bonus dari transaksi membership downline yang benar-benar paid/valid.

## Endpoint

`POST /api/v1/admin/founder-platinum/grants`

Role:

- `SUPER_ADMIN` only.

Body:

```json
{
  "fullName": "Founder Name",
  "phone": "081300000000",
  "password": "InitialPassword",
  "founderId": "FND-001",
  "email": "optional@example.com",
  "sponsorReferralCode": "OPTIONAL",
  "reason": "Founder appreciation account"
}
```

## Database Migration

Migration baru:

`apps/backend/prisma/migrations/0014_founder_platinum_program/migration.sql`

Perubahan:

- Enum `FounderRole`.
- Kolom nullable `user_memberships.founder_role`.
- Tabel `founder_program_grants`.
- Index untuk audit dan query founder grants.

Migration bersifat additive dan tidak mengubah data existing.

## Enforcement

- Maksimal 10 active `FOUNDER_PLATINUM` grants.
- Hanya `SUPER_ADMIN` yang bisa grant.
- Nomor HP dinormalisasi.
- Akun existing ditolak; Founder Platinum hanya untuk user baru.
- Sponsor referral opsional tetap membentuk genealogy referral.
- `founderId` opsional dapat dipakai sebagai referral code deterministik seperti `FND-001`.
- Audit log dibuat dengan action `FOUNDER_PLATINUM_GRANTED`.

## Bonus dan Profit Sharing

Tidak ada pengecualian global berdasarkan `founderRole` di engine bonus/profit sharing.

Perbedaan yang dijaga:

- Founder Platinum sebagai penerima bonus dari downline valid: boleh, karena status membership aktif adalah `PLATINUM`.
- Founder Platinum grant sebagai transaksi pembelian/revenue: tidak boleh, karena tidak ada order paid, invoice paid, payment, atau trigger `MEMBERSHIP_ORDER`.
- Bonus sponsor, level bonus, dan reward tetap hanya diproses oleh flow membership order yang benar-benar paid/valid.

## Seed Script 10 Founder Platinum

Script aman:

`scripts/seed-founder-platinum.ts`

Command dry run:

```bash
npm --workspace apps/backend run seed:founder-platinum -- --dry-run
```

Command execute:

```bash
TAPGO_FOUNDER_PLATINUM_CONFIRM=YES \
FOUNDER_PLATINUM_INITIAL_PASSWORD="<isi-di-terminal-lokal>" \
npm --workspace apps/backend run seed:founder-platinum -- --execute
```

Daftar Founder ID:

- `FND-001` Evi Saepudin
- `FND-002` Atang Supriatna
- `FND-003` M. Dedi Muftiadi
- `FND-004` Dede Sapta Jadi
- `FND-005` Ivan Alfiana
- `FND-006` Lupi Saptiyawan
- `FND-007` Dede Wahid Nurohim
- `FND-008` Sumardi
- `FND-009` Saepudin
- `FND-010` Saprudin

## Rollback Plan

Jika perlu rollback sebelum production:

1. Jangan gunakan endpoint Founder Platinum.
2. Rollback source code ke commit sebelumnya.
3. Jika migration sudah diterapkan di staging/local, hapus data founder grant non-production lalu drop:
   - index founder grant
   - table `founder_program_grants`
   - column `user_memberships.founder_role`
   - enum `FounderRole`

Rollback production harus dilakukan hanya setelah backup database dan review data grant yang sudah dibuat.

## Validasi

- `npm --workspace apps/backend run db:generate`: PASS
- `npm --workspace apps/backend run build`: PASS
- `DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public npx prisma validate --schema apps/backend/prisma/schema.prisma`: PASS
- `npm --workspace apps/backend run test`: PASS untuk unit tests; integration tests skipped karena `TAPGO_TEST_DATABASE_URL` tidak aktif.
- `DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_migrate_clean?schema=public npm --workspace apps/backend run db:deploy`: PASS dari database fresh.
- `TAPGO_FOUNDER_PLATINUM_CONFIRM=YES FOUNDER_PLATINUM_INITIAL_PASSWORD=<local-test-password> DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_migrate_clean?schema=public npm --workspace apps/backend run seed:founder-platinum -- --execute`: PASS.
- Clean database verification:
  - 10 akun Founder Platinum aktif dibuat.
  - Founder ID `FND-001` sampai `FND-010` sesuai.
  - Membership tier `PLATINUM` dan status `ACTIVE`.
  - Wallet `balance = 0`, `cashBalance = 0`, `ppobBalance = 0`.
  - Tidak ada membership order, invoice, payment, wallet transaction, commission, atau revenue saat grant.
  - Grant ke-11 ditolak dengan `FOUNDER_PLATINUM_LIMIT_REACHED`.
- Targeted integration test:
  - `TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test_founder_integration?schema=public DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test_founder_integration?schema=public npm --workspace apps/backend run test -- tests/admin-console/adminConsole.integration.test.ts`: PASS, 5 tests.
  - Test Founder Platinum membuktikan grant tidak membuat invoice/revenue/PPOB, grant ke-11 ditolak, dan Founder Platinum dapat menerima sponsor bonus serta level bonus dari downline paid valid.

Catatan migration deploy: kegagalan sebelumnya berasal dari script Prisma tanpa schema path eksplisit pada workspace. Script `db:deploy`, `db:migrate`, dan `db:generate` sudah dikunci ke `prisma/schema.prisma`, sehingga deployment tidak perlu apply SQL manual.
