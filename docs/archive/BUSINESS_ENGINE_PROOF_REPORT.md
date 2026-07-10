# TapGo Business Engine Proof Report

Tanggal validasi: 9 Juni 2026  
Scope: validasi backend business engine pada database test lokal terpisah.  
Larangan yang dipatuhi: tidak deploy VPS, tidak build APK, tidak menyentuh UI premium, tidak menyentuh dashboard/login/domain production, tidak mengubah database production, tidak reset/seed production.

## 1. Executive Summary

Business Engine TapGo sudah divalidasi dengan integration test nyata memakai `TAPGO_TEST_DATABASE_URL`.

Hasil utama:

- Integration test aktif: PASS.
- Tidak ada skipped test pada run final.
- Referral tree 10 level terbukti.
- Sponsor bonus berbayar terbukti.
- Basic sponsor bonus Rp2.000 hanya keluar setelah downline paid membership upgrade.
- Basic sponsor tidak menerima sponsor bonus 8%.
- Level bonus mengikuti tier:
  - Silver sampai level 3.
  - Gold sampai level 5.
  - Platinum sampai level 10.
- Auto upgrade terbukti:
  - Silver + 5 direct Silver aktif -> Gold.
  - Gold + 10 direct Silver aktif -> Platinum.
  - Pending Silver tidak dihitung.
  - Platinum tidak downgrade.
- Downgrade protection terbukti.
- Wallet ledger tercipta untuk sponsor bonus, level bonus, PPOB benefit, dan withdrawal.
- Idempotency invoice yang sama terbukti menolak proses kedua.

Remaining P1 GAP:

- Rule final menyebut Basic registration benefit Rp5.000 harus masuk PPOB, bukan Wallet Cash.
- Actual saat ini: registrasi Basic membuat `REGISTRATION_BONUS` Rp5.000 di wallet cash.
- Gap ini hanya dicatat, belum diperbaiki, sesuai instruksi validasi saja.

Production readiness score engine setelah validasi test DB: 88%.

Alasan tidak 100%:

- P1 GAP PPOB vs Wallet untuk Basic registration Rp5.000.
- Profit sharing final 60% net profit monthly masih perlu proof khusus formula final terpisah jika akan diproduksikan penuh.

## 2. Test Summary

Test DB:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public
DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public
```

Setup database test yang dijalankan:

```bash
docker compose -f infra/docker-compose.yml up -d
docker exec tapgo-postgres dropdb -U tapgo --if-exists tapgo_test
docker exec tapgo-postgres createdb -U tapgo tapgo_test
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public npm --workspace apps/backend run db:deploy
```

Migration test DB:

- 14 migration applied.
- Dari `0001_init` sampai `20260524164345_member`.
- Tidak ada migration baru dibuat pada tahap ini.

Targeted proof command:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public npx vitest run apps/backend/tests/business-engine/businessEngineProof.integration.test.ts
```

Targeted proof result:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    4.59s
```

Full integration command:

```bash
TAPGO_TEST_DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public DATABASE_URL=postgresql://tapgo:tapgo_password@localhost:5433/tapgo_test?schema=public npm --workspace apps/backend run test
```

Full integration result:

```text
Test Files  9 passed (9)
Tests       77 passed (77)
Duration    15.55s
```

Skip status:

- 0 skipped pada run final.

Build backend:

```text
npm --workspace apps/backend run build
> tsc -p tsconfig.json
PASS
```

Prisma validate:

```text
Prisma schema loaded from apps/backend/prisma/schema.prisma
The schema at apps/backend/prisma/schema.prisma is valid
```

## 3. Expected vs Actual

| Rule | Expected | Actual | Status |
|---|---:|---:|---:|
| Integration test aktif | 0 skip | 77 passed, 0 skip | PASS |
| Basic sponsor saat user baru register | Rp0 | Rp0 | PASS |
| Basic sponsor saat downline upgrade paid Silver | Rp2.000 | Rp2.000 | PASS |
| Basic sponsor tidak dapat 8% | Tidak ada `SPONSOR_BONUS` | Tidak ada `SPONSOR_BONUS` | PASS |
| Silver level bonus | Level 1-3 | Level 1-3 | PASS |
| Gold level bonus | Level 1-5 | Level 1-5 | PASS |
| Platinum level bonus | Level 1-10 | Level 1-10 | PASS |
| Silver + 5 direct active Silver | Gold | Gold | PASS |
| Gold + 10 direct active Silver | Platinum | Platinum | PASS |
| Silver + 4 active + 1 pending Silver | Tetap Silver | Tetap Silver | PASS |
| Platinum + 20 direct Silver | Tetap Platinum | Tetap Platinum | PASS |
| Downgrade Platinum -> Silver | Ditolak | Ditolak | PASS |
| Downgrade Gold -> Silver | Ditolak | Ditolak | PASS |
| Downgrade Platinum -> Gold | Ditolak | Ditolak | PASS |
| Same invoice processed twice | Proses kedua ditolak | `MEMBERSHIP_INVOICE_ALREADY_FINALIZED` | PASS |
| Basic registration benefit | PPOB Rp5.000 | Wallet `REGISTRATION_BONUS` Rp5.000 | P1 GAP |

## 4. Referral Tree Matrix

Genealogy yang dibuat di database test:

```text
A
└─ B
   └─ C
      └─ D
         └─ E
            └─ F
               └─ G
                  └─ H
                     └─ I
                        └─ J
                           └─ K
```

Setup:

- A sampai J dibuat active Platinum untuk membuktikan payout sampai level 10.
- K membeli Silver, lalu Gold, lalu Platinum.
- Payment success diproses lewat `MembershipOrderService.markPaymentSuccess`.
- Data aktual diambil dari `commissions` dan `wallet_transactions`.

## 5. Commission Matrix

### K Membeli Silver

Package amount: Rp500.000

| Penerima | Bonus | Level | Expected | Actual | Rate |
|---|---:|---:|---:|---:|---:|
| J | SPONSOR_BONUS | 1 | Rp40.000 | Rp40.000 | 8% |
| J | LEVEL_BONUS | 1 | Rp40.000 | Rp40.000 | 8% |
| I | LEVEL_BONUS | 2 | Rp20.000 | Rp20.000 | 4% |
| H | LEVEL_BONUS | 3 | Rp10.000 | Rp10.000 | 2% |
| G | LEVEL_BONUS | 4 | Rp10.000 | Rp10.000 | 2% |
| F | LEVEL_BONUS | 5 | Rp10.000 | Rp10.000 | 2% |
| E | LEVEL_BONUS | 6 | Rp5.000 | Rp5.000 | 1% |
| D | LEVEL_BONUS | 7 | Rp5.000 | Rp5.000 | 1% |
| C | LEVEL_BONUS | 8 | Rp5.000 | Rp5.000 | 1% |
| B | LEVEL_BONUS | 9 | Rp5.000 | Rp5.000 | 1% |
| A | LEVEL_BONUS | 10 | Rp5.000 | Rp5.000 | 1% |

### K Membeli Gold

Package amount: Rp3.000.000

| Penerima | Bonus | Level | Expected | Actual | Rate |
|---|---:|---:|---:|---:|---:|
| J | SPONSOR_BONUS | 1 | Rp240.000 | Rp240.000 | 8% |
| J | LEVEL_BONUS | 1 | Rp240.000 | Rp240.000 | 8% |
| I | LEVEL_BONUS | 2 | Rp120.000 | Rp120.000 | 4% |
| H | LEVEL_BONUS | 3 | Rp60.000 | Rp60.000 | 2% |
| G | LEVEL_BONUS | 4 | Rp60.000 | Rp60.000 | 2% |
| F | LEVEL_BONUS | 5 | Rp60.000 | Rp60.000 | 2% |
| E | LEVEL_BONUS | 6 | Rp30.000 | Rp30.000 | 1% |
| D | LEVEL_BONUS | 7 | Rp30.000 | Rp30.000 | 1% |
| C | LEVEL_BONUS | 8 | Rp30.000 | Rp30.000 | 1% |
| B | LEVEL_BONUS | 9 | Rp30.000 | Rp30.000 | 1% |
| A | LEVEL_BONUS | 10 | Rp30.000 | Rp30.000 | 1% |

### K Membeli Platinum

Package amount: Rp5.500.000

| Penerima | Bonus | Level | Expected | Actual | Rate |
|---|---:|---:|---:|---:|---:|
| J | SPONSOR_BONUS | 1 | Rp440.000 | Rp440.000 | 8% |
| J | LEVEL_BONUS | 1 | Rp440.000 | Rp440.000 | 8% |
| I | LEVEL_BONUS | 2 | Rp220.000 | Rp220.000 | 4% |
| H | LEVEL_BONUS | 3 | Rp110.000 | Rp110.000 | 2% |
| G | LEVEL_BONUS | 4 | Rp110.000 | Rp110.000 | 2% |
| F | LEVEL_BONUS | 5 | Rp110.000 | Rp110.000 | 2% |
| E | LEVEL_BONUS | 6 | Rp55.000 | Rp55.000 | 1% |
| D | LEVEL_BONUS | 7 | Rp55.000 | Rp55.000 | 1% |
| C | LEVEL_BONUS | 8 | Rp55.000 | Rp55.000 | 1% |
| B | LEVEL_BONUS | 9 | Rp55.000 | Rp55.000 | 1% |
| A | LEVEL_BONUS | 10 | Rp55.000 | Rp55.000 | 1% |

### Level Limit Matrix

| Upline Tier | Expected | Actual | Status |
|---|---:|---:|---:|
| Silver | Level 1-3 | 1,2,3 | PASS |
| Gold | Level 1-5 | 1,2,3,4,5 | PASS |
| Platinum | Level 1-10 | 1,2,3,4,5,6,7,8,9,10 | PASS |

Log marker:

```text
BUSINESS_ENGINE_PROOF_LEVEL_LIMIT_MATRIX
```

## 6. Wallet Ledger Matrix

Proof test mencetak transaction ID dan timestamp aktual via marker:

```text
BUSINESS_ENGINE_PROOF_WALLET_LEDGER_MATRIX
```

Ringkasan ledger per order:

| Order | Expected Ledger | Actual Ledger | Status |
|---|---:|---:|---:|
| K Silver | 1 PPOB + 1 sponsor + 10 level = 12 | 12 | PASS |
| K Gold | 1 PPOB + 1 sponsor + 10 level = 12 | 12 | PASS |
| K Platinum | 1 PPOB + 1 sponsor + 10 level = 12 | 12 | PASS |

Contoh ledger aktual dari proof test:

| Package | User | Type | Amount | Transaction ID | Timestamp |
|---|---|---|---:|---|---|
| Silver | K | PPOB_BENEFIT | Rp100.000 | `c800517f-b9fb-4b8e-9314-62b42d0046a5` | `2026-06-09T06:54:29.957Z` |
| Silver | J | SPONSOR_BONUS | Rp40.000 | `e2165072-88f5-4c58-9e58-e8ed539aad9f` | `2026-06-09T06:54:29.975Z` |
| Silver | A | LEVEL_BONUS | Rp5.000 | `605e3468-558b-48e6-9709-fe6b02de8fc3` | `2026-06-09T06:54:30.079Z` |
| Gold | K | PPOB_BENEFIT | Rp600.000 | `7829f8ad-2910-4f0c-8a4c-bee389c7c9f7` | `2026-06-09T06:54:30.156Z` |
| Gold | J | SPONSOR_BONUS | Rp240.000 | `3f5f8d39-aaa0-4e00-8758-ef9071976fe2` | `2026-06-09T06:54:30.165Z` |
| Gold | A | LEVEL_BONUS | Rp30.000 | `0df1cf93-c864-45b2-b13c-462c762cb006` | `2026-06-09T06:54:30.280Z` |
| Platinum | K | PPOB_BENEFIT | Rp1.000.000 | `90d86bc9-b5ea-46d5-924f-cf1bd89f3338` | `2026-06-09T06:54:30.334Z` |
| Platinum | J | SPONSOR_BONUS | Rp440.000 | `3e4f95af-2bf3-4174-ad74-c7e1686e7b73` | `2026-06-09T06:54:30.341Z` |
| Platinum | A | LEVEL_BONUS | Rp55.000 | `0aeeaec7-59e1-4752-ad09-1e5bb817178c` | `2026-06-09T06:54:30.427Z` |

Catatan:

- Transaction ID di atas berasal dari run targeted proof terakhir.
- Run berikutnya akan menghasilkan UUID/timestamp baru, tetapi jumlah/type/nominal tetap divalidasi oleh test assertion.

## 7. Basic Sponsor Matrix

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Basic sponsor mengajak user baru register | Rp0 | Rp0 | PASS |
| User baru membeli Silver | BASIC_SPONSOR_BONUS Rp2.000 | BASIC_SPONSOR_BONUS Rp2.000 | PASS |
| Basic sponsor tidak menerima 8% | Tidak ada `SPONSOR_BONUS` | Tidak ada `SPONSOR_BONUS` | PASS |

Log marker:

```text
BUSINESS_ENGINE_PROOF_BASIC_SPONSOR_MATRIX
```

## 8. Auto Upgrade Matrix

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Silver memiliki 5 direct Silver aktif | Gold | Gold | PASS |
| Gold memiliki 10 direct Silver aktif | Platinum | Platinum | PASS |
| Silver memiliki 4 active Silver + 1 pending Silver | Tetap Silver | Tetap Silver | PASS |
| Platinum memiliki 20 direct Silver aktif | Tetap Platinum | Tetap Platinum | PASS |

Log marker:

```text
BUSINESS_ENGINE_PROOF_AUTO_UPGRADE_MATRIX
```

## 9. Downgrade Protection Matrix

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Platinum membeli Silver | Ditolak | Ditolak | PASS |
| Gold membeli Silver | Ditolak | Ditolak | PASS |
| Platinum membeli Gold | Ditolak | Ditolak | PASS |

Error code:

```text
MEMBERSHIP_DOWNGRADE_NOT_ALLOWED
```

Log marker:

```text
BUSINESS_ENGINE_PROOF_DOWNGRADE_MATRIX
```

## 10. Idempotency Matrix

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Invoice yang sama diproses 2x | Proses kedua ditolak | `MEMBERSHIP_INVOICE_ALREADY_FINALIZED` | PASS |
| Membership order ledger count setelah duplicate call | Tidak duplicate | 3 ledger untuk order Platinum direct sponsor scenario | PASS |
| Membership order commission count setelah duplicate call | Tidak duplicate | 2 commission untuk order Platinum direct sponsor scenario | PASS |
| Sponsor bonus duplicate prevention | Unique commission per beneficiary/type/reference/level | PASS di integration suite | PASS |
| Level bonus duplicate prevention | Unique commission per beneficiary/type/reference/level | PASS di integration suite | PASS |
| Reward bonus duplicate prevention | Unique reward milestone commission | PASS di integration suite | PASS |

Log marker:

```text
BUSINESS_ENGINE_PROOF_IDEMPOTENCY_AND_PPOB_MATRIX
```

## 11. Wallet Integrity and Withdrawal Evidence

Withdrawal concurrency test:

- Input wallet: Rp100.000.
- Dua request withdrawal bersamaan: Rp80.000 dan Rp60.000.
- Expected invariant:
  - Hanya satu request fulfilled.
  - Satu request rejected.
  - Wallet balance = Rp100.000 - amount request yang fulfilled.
  - Balance tidak negatif.
  - Hanya satu withdrawal tercipta.
- Actual: PASS.

Catatan validasi:

- Test sebelumnya mengasumsikan Rp80.000 selalu menang race, sehingga bisa flaky.
- Ekspektasi diperbaiki menjadi invariant yang benar: pemenang race boleh Rp80.000 atau Rp60.000, saldo harus sesuai pemenang dan tidak negatif.
- Ini bukan perubahan business rule, melainkan koreksi test agar mengukur properti keamanan wallet yang sebenarnya.

## 12. PPOB vs Wallet Audit

Rule final:

- Basic registration benefit Rp5.000 harus masuk PPOB.
- Bukan wallet cash.

Actual dari test:

```text
Wallet REGISTRATION_BONUS Rp5.000
wallet.balance = Rp5.000
```

Matrix:

| Case | Expected | Actual | Status |
|---|---:|---:|---:|
| Basic registration bonus | PPOB Rp5.000 | Wallet `REGISTRATION_BONUS` Rp5.000 | P1 GAP |

Rekomendasi implementasi P1:

1. Tambahkan pemisahan ledger PPOB Basic dari wallet cash, mengikuti pola `PPOB_BENEFIT`.
2. Terapkan rule 1.000 user pertama.
3. Migrasikan wording/report supaya Basic Rp5.000 tidak dibaca sebagai cash withdrawable.
4. Tambahkan test:
   - User ke-1 mendapat PPOB Basic Rp5.000.
   - User ke-1000 mendapat PPOB Basic Rp5.000.
   - User ke-1001 mendapat Rp0.
   - Wallet cash tetap Rp0 setelah register Basic.

Status:

- Belum diubah karena tahap ini validasi/pembuktian saja.

## 13. Remaining Gap

P1:

- Basic registration Rp5.000 masih masuk Wallet Cash, bukan PPOB.

P2:

- Profit sharing final 60% net profit monthly belum dibuktikan dengan formula final pada tahap proof ini.
- Reward final multi-threshold 10/100/1.000/10.000/100.000 Silver perlu proof lanjutan jika threshold selain 10 akan diaktifkan penuh.

P3:

- Report admin dapat diperluas agar membedakan wallet cash vs PPOB benefit dengan lebih eksplisit setelah P1 diperbaiki.

## 14. Production Readiness Score

Business engine readiness: 88%.

Rincian:

- Referral/sponsor/level/auto-upgrade/downgrade/idempotency/wallet withdrawal safety: kuat untuk UAT lanjutan.
- Belum layak diklaim 100% production-final sampai P1 PPOB Basic diselaraskan.

Rekomendasi:

- Jangan build APK baru sebelum memutuskan apakah P1 PPOB Basic akan diperbaiki sekarang atau dicatat sebagai known issue bisnis.
- Jangan deploy production engine baru hanya berdasarkan report ini tanpa production smoke test terpisah.

## 15. Files Added/Changed In This Validation Stage

Proof/report:

- `BUSINESS_ENGINE_PROOF_REPORT.md`
- `apps/backend/tests/business-engine/businessEngineProof.integration.test.ts`

Test correction:

- `apps/backend/tests/referrals/referralWallet.integration.test.ts`
  - Concurrent withdrawal test diperbaiki dari asumsi pemenang race tertentu menjadi invariant wallet safety.

Compatibility fixes dari validation run sebelumnya yang tetap relevan:

- `apps/backend/src/app.ts`
  - Route `admin/profit-sharing` dipasang sebelum generic `/api/v1/admin`.
- `apps/backend/src/modules/memberships/application/MembershipOrderService.ts`
  - Non-level reward commission memakai `level: 1` agar sesuai constraint DB existing.
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`
  - Profit sharing commission memakai `level: 1` agar sesuai constraint DB existing.
- `apps/backend/src/modules/referrals/application/CommissionEngine.ts`
  - Reward simulation/engine memakai `level: 1` agar konsisten dengan constraint.
- `apps/backend/tests/memberships/membershipOrders.integration.test.ts`
- `apps/backend/tests/profit-sharing/profitSharing.integration.test.ts`
- `apps/backend/tests/referrals/referralWallet.integration.test.ts`
- `apps/backend/tests/e2e/tapgoBusinessEngine.e2e.test.ts`
- `apps/backend/tests/payments/midtrans.integration.test.ts`

Tidak dilakukan:

- Tidak ada APK build.
- Tidak ada VPS deploy.
- Tidak ada schema/migration baru.
- Tidak ada production DB touch.
- Tidak ada UI/dashboard/login/domain/endpoint production change.

## 16. Definition of Done Check

| Requirement | Status |
|---|---:|
| Integration test berjalan | DONE |
| Tidak ada test skip | DONE |
| Referral tree terbukti | DONE |
| Sponsor bonus terbukti | DONE |
| Level bonus terbukti | DONE |
| Auto upgrade terbukti | DONE |
| Downgrade protection terbukti | DONE |
| Wallet ledger terbukti | DONE |
| Idempotency terbukti | DONE |
| PPOB vs Wallet audit | DONE, P1 GAP found |
| `BUSINESS_ENGINE_PROOF_REPORT.md` dibuat | DONE |
