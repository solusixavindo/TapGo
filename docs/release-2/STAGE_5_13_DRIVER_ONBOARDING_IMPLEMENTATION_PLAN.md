# Stage 5.13 — Detailed Implementation Plan, Batch 1–4

> **PROPOSAL ONLY — NOT IMPLEMENTED.**
> Seluruh model, enum, field, constraint, index, SQL, interface, error code, dan nama file dalam dokumen ini adalah usulan.
> Stage 5.13 bersifat **planning-only**. Tidak ada source code, Prisma schema, migration, test, environment, atau infrastruktur yang diubah.

| | |
|---|---|
| Branch | `agent/tapgo-release2-driver` |
| Baseline dokumen | `48cdb9f71eeb97c5cef05f19e7827e1cd077447e` |
| Baseline implementasi | `ea5b5a5d2740342460604bd9d32960398cd5bca5` |
| Arsitektur disetujui | `e0f533633c1e8c959dfd704d26ab9d10f0ed2be8` + `48cdb9f` (Owner Decisions) |
| Tanggal | 2026-08-01 |
| Status | menunggu Owner Review |

---

## 1. Executive Summary

Dokumen ini memecah Batch 1–4 menjadi rencana yang dapat langsung dieksekusi dalam commit kecil, terukur, dan dapat di-rollback, tanpa menyisakan keputusan arsitektur yang diambil diam-diam saat implementasi.

Tiga kesimpulan yang mengubah rencana awal:

1. **Urutan Batch harus dibalik sebagian.** Batch 4 (HMAC service) **wajib** mendahului Batch 1 dan 3, karena `RideDriverApplication.licenseBlindIndex` (D-22) dan `RideVehicle.plateBlindIndex` tidak dapat ditulis sebelum layanan blind index dan kontrak env-nya ada. Menulis schema lebih dulu akan memaksa keputusan format kolom tanpa implementasi yang memvalidasinya. **Urutan yang direkomendasikan: 4 → 1 → 2 → 3.**

2. **`RideVehicle` yang ada perlu direstrukturisasi, bukan hanya ditambahi.** Model sekarang mencampur identitas kendaraan dengan kepemilikan (`driverProfileId` melekat pada `RideVehicle`), dan memakai `plateNumberHash` SHA-256 **unsalted**. Karena tabel terbukti tidak pernah diisi kode produksi (nol `create`), restrukturisasi dapat dilakukan secara additive tanpa backfill — tetapi bukti tabel kosong **wajib diverifikasi ulang** saat implementasi, bukan diasumsikan dari dokumen ini.

3. **Batch 3 menyentuh keputusan yang masih PENDING.** Verifikasi dokumen kendaraan pada transfer (D-18) bergantung pada model dokumen yang diblokir. Rencana menandai bagian ini **BLOCKED — OWNER DECISION REQUIRED** dan mengusulkan Batch 3 berhenti pada transfer tanpa verifikasi dokumen.

**Rekomendasi akhir: GO untuk perencanaan eksekusi Checkpoint 5.14A dan 5.14B; CONDITIONAL GO untuk 5.14C; NO-GO penuh untuk bagian Batch 3 yang bergantung dokumen.** Rincian di §32.

---

## 2. Baseline and Scope

**Dalam ruang lingkup:** Batch 1 (schema foundation aplikasi onboarding), Batch 2 (review claim/lease), Batch 3 (vehicle ownership temporal + transfer), Batch 4 (identifier HMAC blind-index service).

**Di luar ruang lingkup dan tetap diblokir:** dokumen/upload apa pun, integrasi AWS S3/KMS, malware scanning, endpoint HTTP onboarding, UI aplikasi driver, penghapusan model legacy, dan seluruh mutasi Business Engine.

---

## 3. Repository Evidence

Read-only pada `48cdb9f`. **Tidak ada nilai secret yang dibaca atau dicetak.**

| # | File | Symbol/Model | Fungsi dalam rencana | Constraint yang harus dipertahankan | Risiko kompatibilitas |
|---|---|---|---|---|---|
| E-01 | `prisma/schema.prisma:1186` | `RideDriverProfile` | Target approval Batch 1; sumber kapabilitas | `userId @unique`; `status` default `PENDING`; `onDelete: Cascade` | Menambah relasi ke aplikasi harus additive; jangan ubah default |
| E-02 | `prisma/schema.prisma:1206` | `RideVehicle` | Direstrukturisasi di Batch 3 | `@@unique([driverProfileId, plateNumberHash])`; `isActive` default `false` | Memindahkan kepemilikan keluar dari model ini mengubah bentuk relasi |
| E-03 | `prisma/schema.prisma:1270` | `RideOrder` | Harus tetap menunjuk kendaraan historis | `vehicleId String?` → `RideVehicle` **ON DELETE SET NULL**; `driverProfileId` SET NULL | Bila `RideVehicle` dipecah, `vehicleId` harus tetap menunjuk **identitas**, bukan ownership |
| E-04 | `prisma/schema.prisma` `RideOrder` | `fareRuleVersion VarChar(60)` | **Preseden versioning rule** yang dipakai ulang untuk `canonicalizationVersion` | — | — |
| E-05 | `prisma/schema.prisma` | `RideIdempotencyRecord` | Pola idempotensi untuk submit/claim | `@@unique([scope, userId, idempotencyKey])`, `requestHash` | Scope baru harus dinamai konsisten |
| E-06 | `prisma/schema.prisma:606,633` | `Driver`, `DriverDocument` legacy | **Tidak dipakai**; hanya ditandai deprecated | `licenseNumber @unique` plaintext | Jangan sentuh; jangan jadikan basis |
| E-07 | `prisma/schema.prisma:1048` | `AuditLog` | Seluruh audit Batch 1–3 | `actorId?`, `entityType`, `entityId`, `metadata Json?` | `metadata` bebas → disiplin anti-PII wajib |
| E-08 | `src/core/security/authContext.ts` | `requireAuth`, `requireRoles` | Dasar guard; **`requireRoles` tidak baca DB** | Klaim JWT bukan sumber kewenangan | Scope Batch 2 tidak boleh dibangun di atas role saja |
| E-09 | `src/modules/rides/presentation/driverCapability.ts` | `createRequireDriverCapability` | **Stage 5.11** — pola guard DB-authoritative yang ditiru untuk scope | Nol bypass admin; nol cache | Guard baru harus mengikuti pola ini |
| E-10 | `src/modules/rides/application/RideService.ts:1022` | `rideDriverProfile.updateMany` + `applied.count !== 1` | **Pola conditional single-winner** untuk claim/decision | Melempar `RIDE_DRIVER_STATUS_CONFLICT` bila kalah | Pola ini dipakai ulang, bukan diganti |
| E-11 | `src/modules/rides/application/RideService.ts` | 8× `this.prisma.$transaction`, **tanpa `isolationLevel`** | Batch 2 & 3 memakai Read Committed | Pelajaran Stage 5.7: Serializable menambah 40001 tanpa jaminan tambahan | Jangan memperkenalkan Serializable |
| E-12 | `src/modules/rides/application/RideService.ts:1622` | `assertDriverModerationTransition` | Preseden validasi transisi | `PENDING→{ACTIVE,SUSPENDED,REJECTED}` dst. | Transisi aplikasi harus fungsi terpisah, jangan campur |
| E-13 | `src/modules/rides/infrastructure/PrismaMatchingAdapter.ts` | `findCandidates` | Konsumen `RideVehicle` | Filter `isActive` + `verificationStatus: VERIFIED` | Restrukturisasi Batch 3 **wajib** memperbarui query ini |
| E-14 | `prisma/migrations/0016_founder_chairman_unique_guard/migration.sql` | partial unique index | **Preseden** `CREATE UNIQUE INDEX … WHERE` | Sudah terbukti dipakai | — |
| E-15 | `prisma/migrations/` | 23 migrasi; terakhir `20260729120000_ride_domain_foundation` | Penamaan `YYYYMMDDHHMMSS_snake_case` | Timestamp baru harus lebih besar | — |
| E-16 | `src/config/env.ts:4` | `strictEnvBoolean`, `envSchema.parse`, `z.string().min(32)` | Kontrak env Batch 4 | Fail-closed saat parse gagal | Kunci baru harus wajib bila fitur aktif |
| E-17 | `src/config/env.ts:76-94` | Guard CORS produksi yang `throw` saat tidak aman | **Preseden startup validation fail-closed** untuk key registry Batch 4 | — | — |
| E-18 | `src/lib/doku/signature.ts:69` | `createHmac("sha256", …)` | Preseden HMAC | — | — |
| E-19 | `src/core/logger/logger.ts:6` | `redact.paths` | Harus diperluas untuk identifier Batch 4 | Sudah mencakup token/secret | Path baru wajib ditambahkan bersamaan |
| E-20 | `tests/helpers/referralWalletHarness.ts:9,39` | `TAPGO_TEST_DATABASE_URL` + guard `includes("test")` + `connection_limit=30` | Lifecycle test DB | Nama DB wajib memuat `test` | Test baru harus memakai harness ini |
| E-21 | `src/modules/rides/` | `application/`, `domain/`, `infrastructure/`, `presentation/` | Batas modul yang diikuti | Service dirakit di `ride.routes.ts` dengan `new RideService(...)` | Service baru mengikuti komposisi sama |
| E-22 | `src/core/security/rateLimit.ts` | 8 limiter | Batch 2 memakai `adminRateLimiter` | Belum ada limiter onboarding | Limiter baru menyusul saat endpoint dibuat (bukan Batch 1–4) |
| E-23 | `src/modules/rides/` | 24 kode `RIDE_*` | Konvensi error code | Prefiks `RIDE_` dipertahankan | Kode baru mengikuti konvensi |

---

## 4. Binding Owner Decisions

Ke-21 keputusan pada brief Owner diterima sebagai batasan mengikat dan tidak diulang di sini. Yang paling berdampak pada rencana teknis:

- Kapabilitas driver **hanya** dari `User.status = ACTIVE` **dan** `RideDriverProfile.status = ACTIVE`; role bukan sumber authority; nol bypass admin (mengunci desain guard Batch 2).
- Identifier sensitif memakai **keyed HMAC-SHA256 ber-versi**; **tidak ada** konversi blind index lama tanpa raw canonical identifier; migrasi hanya lazy (mengunci desain Batch 4 dan menjadikannya prasyarat Batch 1 & 3).
- Vehicle ownership **temporal** dengan transfer ter-review dan atomik; SIM **tidak dapat ditransfer**, satu SIM satu identitas driver.
- Review lease **15 menit** dengan claim/renew/release/expiry/reassignment dan audit penuh.
- `WITHDRAWN` terminal; resubmission membuat cycle baru.
- Upload dokumen **BLOCKED**; S3/KMS sudah dipilih tetapi **tidak** diintegrasikan pada tahap ini.

---

## 5. Pending Decisions and Exclusions

Tidak ada nilai default yang diasumsikan. Titik sentuh Batch 1–4 dengan keputusan yang belum diambil:

| Titik sentuh | Keputusan | Perlakuan dalam rencana |
|---|---|---|
| Menyimpan raw NIK/SIM untuk pemulihan | **D-04** | **BLOCKED — OWNER DECISION REQUIRED.** Rencana **hanya** menyimpan blind index + masked. Tidak ada kolom raw/encrypted diusulkan. Bila D-04 kelak menyetujui, kolom terenkripsi ditambahkan sebagai migrasi terpisah |
| Kelengkapan dokumen sebagai syarat `SUBMITTED` | **D-07** | **BLOCKED.** Validasi `SUBMITTED` pada Batch 1 hanya memeriksa field non-dokumen. Aturan kelengkapan dokumen ditambahkan saat batch dokumen dibuka |
| Verifikasi dokumen kendaraan pada transfer (D-18) | **D-07/D-09/D-10** | **BLOCKED.** Batch 3 mengimplementasikan transfer **tanpa** langkah verifikasi dokumen; kendaraan hasil transfer tetap `verificationStatus = PENDING`, `isActive = false` sehingga tidak dapat menerima order |
| Cooldown resubmit setelah `REJECTED` | **D-20** | **Tidak diterapkan.** Resubmit diizinkan tanpa cooldown. Ini dinyatakan eksplisit, bukan default diam-diam. Penambahan cooldown adalah perubahan terpisah |
| Retensi/penghapusan aplikasi & audit | **D-11…D-16** | Di luar Batch 1–4. Tidak ada job retensi dirancang |
| Penghapusan model legacy | **D-23** | Hanya komentar `///` deprecated; **tanpa** penghapusan |
| Selfie/liveness, MIME, ukuran, scanner | **D-08/D-09/D-10** | Di luar Batch 1–4 |
| Legal | **L-1…L-6** | Tetap terbuka |

---

## 6. Batch 1 — Schema Foundation Plan

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 6.1 Jawaban atas 15 pertanyaan wajib

1. **Beberapa historical application per User?** **Ya.** Setiap cycle adalah baris terpisah; `REJECTED`/`WITHDRAWN` dipertahankan sebagai histori. `cycleNumber` monotonik per user memudahkan pembacaan.
2. **Menjamin satu open cycle per User?** Partial unique index pada `user_id` dengan predikat status open. Bukan unique penuh (itu akan melarang histori).
3. **Status "open"?** `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`. `APPROVED`, `REJECTED`, `WITHDRAWN` terminal. Catatan desain: `APPROVED` dimasukkan terminal karena setelah approval siklus hidup berpindah ke `RideDriverProfile.status`.
4. **Partial unique di PostgreSQL?** `CREATE UNIQUE INDEX … ON ride_driver_applications (user_id) WHERE status IN ('DRAFT','SUBMITTED','UNDER_REVIEW');` — preseden E-14.
5. **Prisma merepresentasikan constraint yang tidak didukung?** Prisma tidak mendukung partial unique index secara deklaratif. Solusi: tulis di **migration SQL manual**, dan tambahkan komentar `///` pada model agar tidak hilang saat `prisma format`. `prisma migrate diff` akan tetap bersih karena index dibuat lewat SQL yang di-commit; **wajib** diverifikasi dengan `prisma migrate status` + drift check.
6. **`WITHDRAWN` tetap terminal?** Fungsi transisi menolak semua keluar dari terminal, ditambah CHECK constraint yang melarang `withdrawnAt` terisi pada status non-`WITHDRAWN`.
7. **Resubmission membuat cycle baru?** Tidak ada transisi keluar dari `REJECTED`/`WITHDRAWN`. Resubmit = `INSERT` baris baru dengan `cycleNumber + 1`; dijaga partial unique agar tidak ada dua open.
8. **Duplicate submit dicegah?** Conditional update `WHERE status='DRAFT'`; `count === 0` → sudah `SUBMITTED` → kembalikan state saat ini (200), bukan error. Plus `RideIdempotencyRecord` scope `driver_application_submit`.
9. **Approval membuat/mengaktifkan profil secara idempotent?** Satu transaksi: conditional update aplikasi → `upsert` `RideDriverProfile` by `userId` (`create` status `ACTIVE`; `update` hanya menaikkan `PENDING → ACTIVE`, **tidak** menyentuh `SUSPENDED`/`REJECTED`) → `INSERT AuditLog`. `userId @unique` membuat upsert aman terhadap balapan.
10. **Race approve vs withdraw?** Keduanya conditional pada status saat ini. `withdraw` hanya sah untuk `DRAFT`/`SUBMITTED`; begitu `UNDER_REVIEW`, withdraw ditolak `RIDE_DRIVER_APPLICATION_INVALID_STATE`. Approve hanya sah dari `UNDER_REVIEW`. Tidak ada irisan sah → tidak ada hasil campur.
11. **Validasi transisi?** Fungsi murni `assertApplicationTransition(current, next)` di `domain/`, meniru E-12, diuji unit terpisah dari DB.
12. **Audit dihubungkan?** `AuditLog.entityType = 'RideDriverApplication'`, `entityId = application.id`, ditulis **dalam transaksi yang sama**.
13. **PII diminimalkan?** Tidak menduplikasi `fullName`/`phone` (sudah di `users`). SIM hanya `licenseBlindIndex` + `licenseMasked`. NIK **tidak** disimpan pada Batch 1 (BLOCKED D-04/D-07).
14. **Tidak menyimpan URL/raw dokumen?** Batch 1 **tidak** memiliki model dokumen sama sekali. Tidak ada kolom `url`, `storageKey`, atau `bytea`.
15. **Legacy dicegah dipakai baru?** Komentar `///` `@deprecated` pada `Driver`/`DriverDocument`/`DriverEarning` + catatan di dokumen. Opsional: lint rule kustom. **Tanpa** penghapusan (D-23).

### 6.2 Proposed Prisma model

```prisma
// PROPOSAL ONLY — NOT IMPLEMENTED
/// Satu siklus pengajuan driver. Histori dipertahankan; resubmission
/// membuat baris baru, bukan mengubah baris lama.
/// Partial unique index (satu open cycle per user) dibuat lewat raw SQL
/// pada migration karena Prisma tidak mendukungnya secara deklaratif.
model RideDriverApplication {
  id                     String                       @id @default(uuid()) @db.Uuid
  userId                 String                       @map("user_id") @db.Uuid
  cycleNumber            Int                          @map("cycle_number")
  status                 RideDriverApplicationStatus  @default(DRAFT)
  version                Int                          @default(0)

  // Identitas SIM — hanya blind index + masked. Raw TIDAK disimpan (D-04 PENDING).
  licenseBlindIndex      String?                      @map("license_blind_index") @db.VarChar(64)
  licenseKeyVersion      Int?                         @map("license_key_version")
  licenseCanonVersion    Int?                         @map("license_canon_version")
  licenseMasked          String?                      @map("license_masked") @db.VarChar(32)
  licenseExpiresAt       DateTime?                    @map("license_expires_at")
  indexMigrationState    RideIdentifierMigrationState @default(CURRENT) @map("index_migration_state")

  submittedAt            DateTime?                    @map("submitted_at")
  approvedAt             DateTime?                    @map("approved_at")
  rejectedAt             DateTime?                    @map("rejected_at")
  withdrawnAt            DateTime?                    @map("withdrawn_at")
  decisionReasonCode     String?                      @map("decision_reason_code") @db.VarChar(60)

  createdAt              DateTime                     @default(now()) @map("created_at")
  updatedAt              DateTime                     @updatedAt @map("updated_at")

  user                   User                         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, cycleNumber])
  @@index([status, createdAt])
  @@map("ride_driver_applications")
}
```

**Rationale nullability:** field SIM nullable karena `DRAFT` boleh belum lengkap; wajib diisi saat transisi ke `SUBMITTED` (divalidasi aplikasi + CHECK constraint). `submittedAt`/`approvedAt`/`rejectedAt`/`withdrawnAt` nullable karena hanya terisi pada status terkait. `decisionReasonCode` memakai **kode**, bukan teks bebas, untuk mencegah PII masuk audit.

### 6.3 Constraint & index SQL

```sql
-- PROPOSAL ONLY — NOT IMPLEMENTED
-- Satu open application cycle per user.
CREATE UNIQUE INDEX "ride_driver_applications_one_open_per_user_key"
  ON "ride_driver_applications" ("user_id")
  WHERE "status" IN ('DRAFT','SUBMITTED','UNDER_REVIEW');

-- Satu SIM hanya untuk satu identitas driver (D-22), dievaluasi per key version.
CREATE UNIQUE INDEX "ride_driver_applications_license_blind_index_key"
  ON "ride_driver_applications" ("license_blind_index", "license_key_version")
  WHERE "license_blind_index" IS NOT NULL
    AND "status" IN ('SUBMITTED','UNDER_REVIEW','APPROVED');

-- Timestamp hanya boleh terisi pada status yang sesuai.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_terminal_timestamp_check" CHECK (
    ("status" = 'APPROVED'  AND "approved_at"  IS NOT NULL OR "status" <> 'APPROVED')
    AND ("status" = 'REJECTED'  AND "rejected_at"  IS NOT NULL OR "status" <> 'REJECTED')
    AND ("status" = 'WITHDRAWN' AND "withdrawn_at" IS NOT NULL OR "status" <> 'WITHDRAWN')
  );

-- SUBMITTED ke atas wajib membawa identitas SIM lengkap.
ALTER TABLE "ride_driver_applications"
  ADD CONSTRAINT "ride_driver_applications_license_required_check" CHECK (
    "status" = 'DRAFT'
    OR ("license_blind_index" IS NOT NULL AND "license_key_version" IS NOT NULL
        AND "license_canon_version" IS NOT NULL AND "license_masked" IS NOT NULL)
  );
```

**Catatan penting pada unique SIM:** index menyertakan `license_key_version`. Konsekuensinya, selama rotasi kunci, satu SIM yang tersimpan dengan v1 **tidak** otomatis bentrok dengan v2 pada level database — deduplication lintas versi ditegakkan di **application layer** lewat dual lookup (Batch 4). Ini disengaja dan konsisten dengan Owner Decision 15 (blind index lama tidak dapat dikonversi). **Test wajib** membuktikan dual lookup menangkap duplikat lintas versi.

### 6.4 Transaction boundary, error code, migrasi

| Operasi | Transaction boundary |
|---|---|
| Create application | Satu transaksi: cek open cycle → `INSERT` → audit |
| Submit | Conditional update `WHERE status='DRAFT' AND version=:v` → audit |
| Approve | Conditional update → `upsert RideDriverProfile` → audit (satu transaksi) |
| Reject / Withdraw | Conditional update → audit |

Error code (§18). Migration filename yang diusulkan: `20260802090000_driver_application_foundation` — timestamp harus lebih besar dari `20260729120000` (E-15) dan **diverifikasi ulang** saat implementasi.

**Rollback:** additive murni. Rollback = berhenti memakai tabel; tabel kosong dapat di-`DROP` pada migrasi forward-fix terpisah. **Forward-fix** lebih disukai daripada `prisma migrate resolve --rolled-back`.

**Compatibility impact:** nol. Tidak ada tabel existing yang diubah; `RideDriverProfile` hanya menerima relasi balik opsional (dapat ditambahkan tanpa mengubah kolom).

---

## 7. Batch 2 — Review Claim/Lease Plan

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 7.1 Field tambahan pada `RideDriverApplication`

```prisma
// PROPOSAL ONLY — NOT IMPLEMENTED
  claimedBy       String?   @map("claimed_by") @db.Uuid
  claimedAt       DateTime? @map("claimed_at")
  claimExpiresAt  DateTime? @map("claim_expires_at")
  releasedAt      DateTime? @map("released_at")
  releaseReason   String?   @map("release_reason") @db.VarChar(60)
  reviewedBy      String?   @map("reviewed_by") @db.Uuid
  reviewedAt      DateTime? @map("reviewed_at")

  claimer  User? @relation("RideDriverApplicationClaimer",  fields: [claimedBy], references: [id], onDelete: SetNull)
  reviewer User? @relation("RideDriverApplicationReviewer", fields: [reviewedBy], references: [id], onDelete: SetNull)

  @@index([status, claimExpiresAt])
```

`onDelete: SetNull` dipilih agar penghapusan akun admin tidak menghapus histori review. `version` (Batch 1) dipakai sebagai optimistic lock; tidak ada `claimVersion` terpisah — satu penghitung lebih sederhana dan sudah cukup.

### 7.2 Predikat transaksi

Seluruh keputusan waktu memakai **`now()` dari PostgreSQL**, bukan waktu klien maupun waktu proses Node — menghilangkan clock skew antar instance.

```sql
-- PROPOSAL ONLY — NOT IMPLEMENTED

-- (1)(2)(11) Claim unclaimed ATAU expired, atomik, tahan balapan.
UPDATE ride_driver_applications
   SET status='UNDER_REVIEW', claimed_by=:actor, claimed_at=now(),
       claim_expires_at = now() + interval '15 minutes',
       released_at=NULL, release_reason=NULL, version=version+1
 WHERE id=:id
   AND ( status='SUBMITTED'
      OR (status='UNDER_REVIEW' AND claim_expires_at < now()) )
RETURNING id, version, claim_expires_at;

-- (3) Renew own active claim.
UPDATE ride_driver_applications
   SET claim_expires_at = now() + interval '15 minutes', version=version+1
 WHERE id=:id AND status='UNDER_REVIEW'
   AND claimed_by=:actor AND claim_expires_at >= now()
RETURNING claim_expires_at;

-- (4) Release own claim.
UPDATE ride_driver_applications
   SET status='SUBMITTED', claimed_by=NULL, claimed_at=NULL, claim_expires_at=NULL,
       released_at=now(), release_reason=:reasonCode, version=version+1
 WHERE id=:id AND status='UNDER_REVIEW' AND claimed_by=:actor;

-- (5) Privileged reassignment (scope driver.review.reassign).
UPDATE ride_driver_applications
   SET claimed_by=:newActor, claimed_at=now(),
       claim_expires_at = now() + interval '15 minutes',
       released_at=now(), release_reason='REASSIGNED', version=version+1
 WHERE id=:id AND status='UNDER_REVIEW'
RETURNING id;

-- (6)(7)(8)(9) Decision — hanya pemilik claim yang masih hidup.
UPDATE ride_driver_applications
   SET status=:decision, reviewed_by=:actor, reviewed_at=now(),
       approved_at = CASE WHEN :decision='APPROVED' THEN now() ELSE approved_at END,
       rejected_at = CASE WHEN :decision='REJECTED' THEN now() ELSE rejected_at END,
       decision_reason_code=:reasonCode,
       claimed_by=NULL, claimed_at=NULL, claim_expires_at=NULL, version=version+1
 WHERE id=:id AND status='UNDER_REVIEW'
   AND claimed_by=:actor AND claim_expires_at >= now()
   AND version=:expectedVersion
RETURNING id;
```

`0 row` pada setiap statement → error code spesifik (§18), **bukan** kegagalan diam-diam.

**Kompatibilitas Prisma/PostgreSQL:** pola `updateMany` + `count !== 1` (E-10) sudah dipakai di repo dan **cukup** untuk (1)(3)(4)(6). Namun predikat `claim_expires_at < now()` membandingkan kolom dengan waktu **server database**, yang tidak dapat diekspresikan lewat Prisma query builder (Prisma akan mengirim timestamp dari Node). Karena itu:

- Statement yang melibatkan `now()` → `tx.$executeRaw` di dalam `$transaction`, mengikuti preseden `$executeRaw` yang sudah ada di `PrismaAuthRepository`.
- Statement tanpa `now()` → boleh memakai `updateMany`.

**Ini keputusan teknis yang harus dicatat, bukan diputuskan diam-diam saat coding.**

- **(10) Reviewer crash:** lease kedaluwarsa sendiri; tidak ada job latar. Reviewer yang kembali harus claim ulang.
- **(12) Clock boundary:** hanya `now()` database; tidak ada perbandingan waktu di Node.
- **(13) Transaction retry:** Read Committed (E-11). Retry hanya untuk `P2034`/`40001` bila muncul, mengikuti pola Stage 5.7; **tidak** memperluas kelas error retryable.

### 7.3 Explicit scopes

`driver.review.claim`, `driver.review.read`, `driver.review.decide`, `driver.review.reassign`.

**BLOCKED — OWNER DECISION REQUIRED (D-18b turunan):** mekanisme *penyimpanan* dan *pemberian* scope belum ada di repo (G-12). Batch 2 mengusulkan guard `requireScopes(...)` yang membaca scope dari tabel baru `AdminScopeGrant` — **tetapi model dan alur pemberiannya belum disetujui**. Bila Owner belum memutuskan, Batch 2 hanya boleh mengimplementasikan *service layer + transaksi*, dan guard scope menyusul.

### 7.4 Authorization matrix

| Aktor | read | claim | renew | release | reassign | decide |
|---|---|---|---|---|---|---|
| Applicant (pemilik) | ✅ miliknya | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reviewer (`claim`+`read`+`decide`) | ✅ | ✅ | ✅ miliknya | ✅ miliknya | ❌ | ✅ bila claim hidup |
| Senior reviewer (+`reassign`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ADMIN tanpa scope** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SUPER_ADMIN tanpa scope** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Expired claim holder | ✅ | ✅ (claim ulang) | ❌ | ❌ | ❌ | **❌** |
| Unrelated reviewer | ✅ | ✅ bila expired/unclaimed | ❌ | ❌ | ❌ | ❌ |

---

## 8. Batch 3 — Vehicle Ownership Plan

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 8.1 Jawaban atas 20 pertanyaan wajib

1. **`RideVehicle` merepresentasikan apa?** **Kendaraan fisik (identitas)**, bukan plate assignment. Kepemilikan dipindah ke `RideVehicleOwnership`.
2. **Perubahan plate?** Plat baru = **kendaraan identitas baru**; kendaraan lama `RETIRED`; ownership baru dibuat dengan `endReason='PLATE_CHANGE'` pada yang lama. Alternatif "mengubah plat di tempat" ditolak karena akan menulis ulang histori (`RideOrder` lama akan tampak memakai plat baru).
3. **Plate blind index disimpan?** `plateBlindIndex VarChar(64)` (hex HMAC-SHA256).
4. **`keyVersion`?** `plateKeyVersion Int`.
5. **`canonicalizationVersion`?** `plateCanonVersion Int` — preseden `fareRuleVersion` (E-04).
6. **Satu active ownership per vehicle?** Partial unique pada `vehicle_id WHERE status='ACTIVE'`.
7. **Satu active plate assignment?** Karena `plateBlindIndex` unik pada level identitas kendaraan, dan satu kendaraan hanya punya satu ownership `ACTIVE`, maka satu plat hanya punya satu pemilik aktif. **Tidak** memakai unique global permanen pada plat tanpa lifecycle.
8. **Transfer atomik?** Satu `$transaction`: tutup ownership lama → buat ownership baru → audit. Partial unique menjamin kegagalan (bukan dua pemilik) bila ada transfer paralel.
9. **Ownership lama ditutup?** `status='TRANSFERRED'`, `endedAt=now()`, `endReason`.
10. **Histori tidak dapat ditulis ulang?** Baris ownership bersifat append-only secara kebijakan; hanya kolom penutup yang boleh diisi sekali. CHECK constraint melarang `endedAt` kosong pada status non-`ACTIVE`.
11. **Retirement?** `status='RETIRED'`, `isActive=false`.
12. **Replacement?** Retire lama + ownership baru pada kendaraan lain.
13. **Suspended vehicle vs suspended driver?** `ownership.status='SUSPENDED'` **tidak** menyentuh `RideDriverProfile.status` maupun `User.status` → kapabilitas penumpang dan driver tidak terpengaruh (Owner Decision 7).
14. **`RideOrder` lama tetap benar?** `RideOrder.vehicleId` menunjuk **identitas** `RideVehicle` yang tidak pernah dipindah/dihapus (E-03).
15. **Snapshot atribut kendaraan pada `RideOrder`?** **Direkomendasikan ya** — `vehiclePlateMasked` dan `vehicleTypeSnapshot` pada `RideOrder`, karena atribut identitas (warna/merek) dapat berubah dan tampilan riwayat harus stabil. **Namun ini menambah kolom pada tabel existing** → diusulkan sebagai migrasi additive nullable terpisah, dan **ditandai sebagai keputusan yang perlu persetujuan** karena menyentuh model di luar Batch 3 murni.
16. **Transfer conflict?** Conditional update + partial unique → yang kalah mendapat `RIDE_VEHICLE_TRANSFER_CONFLICT` (409).
17. **Otorisasi transfer?** Scope `vehicle.transfer.review`; role saja tidak cukup.
18. **Raw plate dicegah masuk log?** Plat mentah tidak pernah melewati logger; `logger.redact.paths` diperluas (E-19); hanya `plateMasked` yang boleh muncul.
19. **`plateNumberHash` unsalted existing?** Karena tabel terbukti tidak pernah diisi produksi, kolom lama **dibiarkan** (deprecated) dan kolom blind index baru ditambahkan. **Tidak** ada backfill.
20. **Mengapa backfill belum boleh?** Karena HMAC memerlukan **canonical raw plate** yang tidak tersedia dari SHA-256 lama — konsisten dengan Owner Decision 15. Bila kelak ada baris nyata, migrasi hanya lazy saat plat diberikan kembali lewat alur sah.

### 8.2 Proposed schema

```prisma
// PROPOSAL ONLY — NOT IMPLEMENTED
model RideVehicleOwnership {
  id                 String                        @id @default(uuid()) @db.Uuid
  vehicleId          String                        @map("vehicle_id") @db.Uuid
  driverProfileId    String                        @map("driver_profile_id") @db.Uuid
  status             RideVehicleOwnershipStatus    @default(ACTIVE)
  verificationStatus RideVehicleVerificationStatus @default(PENDING) @map("verification_status")
  isActive           Boolean                       @default(false) @map("is_active")
  startedAt          DateTime                      @default(now()) @map("started_at")
  endedAt            DateTime?                     @map("ended_at")
  endReason          String?                       @map("end_reason") @db.VarChar(60)
  createdAt          DateTime                      @default(now()) @map("created_at")
  updatedAt          DateTime                      @updatedAt @map("updated_at")

  vehicle       RideVehicle       @relation(fields: [vehicleId], references: [id], onDelete: Restrict)
  driverProfile RideDriverProfile @relation(fields: [driverProfileId], references: [id], onDelete: Restrict)

  @@index([driverProfileId, status])
  @@index([vehicleId, status])
  @@map("ride_vehicle_ownerships")
}

model RideVehicleTransfer {
  id                String                      @id @default(uuid()) @db.Uuid
  vehicleId         String                      @map("vehicle_id") @db.Uuid
  fromOwnershipId   String?                     @map("from_ownership_id") @db.Uuid
  toDriverProfileId String                      @map("to_driver_profile_id") @db.Uuid
  status            RideVehicleTransferStatus   @default(PENDING)
  requestedBy       String                      @map("requested_by") @db.Uuid
  reviewedBy        String?                     @map("reviewed_by") @db.Uuid
  reviewedAt        DateTime?                   @map("reviewed_at")
  reasonCode        String?                     @map("reason_code") @db.VarChar(60)
  version           Int                         @default(0)
  createdAt         DateTime                    @default(now()) @map("created_at")

  @@index([vehicleId, status])
  @@map("ride_vehicle_transfers")
}
```

Kolom tambahan pada `RideVehicle` (additive, nullable): `plateBlindIndex`, `plateKeyVersion`, `plateCanonVersion`, `plateIndexMigrationState`. Kolom lama `plateNumberHash` dan `driverProfileId` **dibiarkan** dan ditandai deprecated agar migrasi tetap additive.

`onDelete: Restrict` dipilih agar histori kepemilikan tidak dapat hilang diam-diam.

### 8.3 Constraint SQL

```sql
-- PROPOSAL ONLY — NOT IMPLEMENTED
CREATE UNIQUE INDEX "ride_vehicle_ownerships_one_active_per_vehicle_key"
  ON "ride_vehicle_ownerships" ("vehicle_id") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ride_vehicles_plate_blind_index_key"
  ON "ride_vehicles" ("plate_blind_index", "plate_key_version")
  WHERE "plate_blind_index" IS NOT NULL;

ALTER TABLE "ride_vehicle_ownerships"
  ADD CONSTRAINT "ride_vehicle_ownerships_ended_at_check"
  CHECK ("status" = 'ACTIVE' OR "ended_at" IS NOT NULL);

ALTER TABLE "ride_vehicle_ownerships"
  ADD CONSTRAINT "ride_vehicle_ownerships_active_requires_verified_check"
  CHECK ("is_active" = false OR "verification_status" = 'VERIFIED');
```

### 8.4 Dampak pada konsumen existing

`PrismaMatchingAdapter.findCandidates` (E-13) memfilter `vehicles.some({ isActive, verificationStatus })` melalui relasi `RideVehicle.driverProfileId`. Setelah kepemilikan pindah ke `RideVehicleOwnership`, query ini **wajib diperbarui** untuk memfilter lewat ownership `ACTIVE`. **Ini perubahan pada kode yang sudah diuji** dan menjadi risiko utama Batch 3 — test `rideFoundation` yang ada harus tetap hijau.

**BLOCKED — OWNER DECISION REQUIRED:** langkah "memverifikasi dokumen kendaraan baru" pada D-18 tidak dapat diimplementasikan tanpa model dokumen (D-07/D-09/D-10). Batch 3 berhenti pada transfer + audit; kendaraan hasil transfer tetap `PENDING`/`isActive=false`.

---

## 9. Batch 4 — Identifier HMAC Service Plan

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 9.1 Domain & canonicalization

| Domain | Canonicalization | Catatan |
|---|---|---|
| `nik` | digits-only; **wajib tepat 16 digit**; leading zero dipertahankan; **jangan** di-parse sebagai number | Digunakan hanya bila D-07 mewajibkan — **BLOCKED** untuk Batch 1 |
| `sim` | trim; uppercase; hapus whitespace. **Tidak** menghapus tanda hubung atau karakter lain tanpa bukti bahwa karakter itu tidak membedakan identifier | Konservatif dengan sengaja — normalisasi berlebihan dapat menggabungkan dua SIM berbeda |
| `plate` | uppercase; normalisasi whitespace; hapus separator (`-`, spasi ganda) → `B 1234 ABC` = `B1234ABC` | Identitas terpisah dari kepemilikan |
| `stnk` | **future only** — didaftarkan di enum domain tetapi **dilarang dipakai** sampai keputusan dokumen/legal | Fail-closed bila dipanggil |

`canonicalizationVersion` disimpan per baris agar perubahan aturan normalisasi di masa depan tidak diam-diam mengubah makna index lama.

### 9.2 Proposed interface

```ts
// PROPOSAL ONLY — NOT IMPLEMENTED
export type IdentifierDomain = "nik" | "sim" | "plate" | "stnk";

export type BlindIndex = {
  value: string;        // hex HMAC-SHA256
  keyVersion: number;
  canonVersion: number;
};

export interface IdentifierIndexService {
  normalize(domain: IdentifierDomain, raw: string): string;
  createIndex(domain: IdentifierDomain, raw: string): BlindIndex;              // write key
  createLookupIndexes(domain: IdentifierDomain, raw: string): BlindIndex[];    // semua active key
  verifyIndex(domain: IdentifierDomain, raw: string, stored: BlindIndex): boolean; // timingSafeEqual
  planLazyMigration(domain: IdentifierDomain, raw: string, stored: BlindIndex):
    { needsMigration: boolean; next?: BlindIndex };
}
```

Nama final mengikuti pola repo (`src/core/security/identifierIndex.ts`, kelas atau factory sesuai konvensi modul).

### 9.3 Key registry & env contract

Nama environment variable yang **diusulkan** (nilai tidak pernah ditulis di mana pun):
`IDENTIFIER_INDEX_KEY_CURRENT_VERSION`, `IDENTIFIER_INDEX_KEY_V1`, `IDENTIFIER_INDEX_KEY_V2`.

Validasi mengikuti E-16 (`z.string().min(32)`), dan startup validation fail-closed mengikuti preseden E-17:

| Kondisi | Perilaku |
|---|---|
| `CURRENT_VERSION` menunjuk kunci yang tidak ada | **throw saat startup** |
| Lebih dari dua kunci aktif | **throw saat startup** (Owner Decision 15) |
| Kunci hilang saat runtime | **fail-closed** — tolak operasi, jangan lewati diam-diam |
| `keyVersion` tidak dikenal pada baris DB | **fail-closed** + audit `identifier.unknown_key_version` |
| Fallback ke kunci lama berhasil | audit `identifier.legacy_key_lookup` (domain + keyVersion saja, **tanpa** nilai) |

### 9.4 Lazy migration

Sesuai Owner Decision 15: blind index lama **tidak dapat** dikonversi tanpa raw canonical identifier. Migrasi hanya terjadi ketika identifier diberikan kembali lewat alur sah (verified resubmission, verifikasi ulang, authorized workflow). Dalam satu transaksi: hitung index kunci lama → temukan baris → hitung index kunci baru → simpan index + `keyVersion` + `canonVersion` baru → **jangan** simpan raw → **jangan** log raw maupun index.

`indexMigrationState`: `CURRENT` · `LEGACY_PENDING_REVERIFICATION` · `LEGACY_UNRECOVERABLE`.

### 9.5 Synthetic test vectors

Hanya nilai sintetis; **dilarang** memakai NIK/SIM/STNK/plat milik orang nyata.

| Domain | Input sintetis | Canonical harapan |
|---|---|---|
| `nik` | `0000 0000 0000 0001` | `0000000000000001` (leading zero utuh) |
| `nik` | `123` | **tolak** — bukan 16 digit |
| `sim` | ` test-sim-0001 ` | `TEST-SIM-0001` (tanda hubung dipertahankan) |
| `plate` | `z 0001 zz` | `Z0001ZZ` |
| `plate` | `Z-0001-ZZ` | `Z0001ZZ` (sama dengan di atas) |
| `stnk` | apa pun | **tolak** — domain future, fail-closed |

Nilai HMAC harapan **tidak** dicantumkan di dokumen maupun di test yang ter-commit; test memverifikasi **properti** (determinisme, domain separation, version separation), bukan konstanta yang bergantung secret.

---

## 10. Proposed Prisma Models

**PROPOSAL ONLY — NOT IMPLEMENTED.**

| Model | Batch | Status | Definisi |
|---|---|---|---|
| `RideDriverApplication` | 1 (+kolom lease di 2) | baru | §6.2 dan §7.1 |
| `RideVehicleOwnership` | 3 | baru | §8.2 |
| `RideVehicleTransfer` | 3 | baru | §8.2 |
| `RideVehicle` | 3 | **diubah additive** — kolom `plateBlindIndex`, `plateKeyVersion`, `plateCanonVersion`, `plateIndexMigrationState` (semua nullable); `plateNumberHash` dan `driverProfileId` ditandai deprecated tetapi **tetap ada** | §8.2 |
| `RideDriverProfile` | 1 | **tidak diubah**; hanya menerima relasi balik opsional | E-01 |
| `RideOrder` | — | **tidak diubah** pada Batch 1–4; usulan snapshot kendaraan (§8.1 no. 15) memerlukan persetujuan terpisah | E-03 |

**Tidak ada model dokumen pada Batch 1–4.** Tidak ada kolom `url`, `storageKey`, atau `bytea` di mana pun.

---

## 11. Proposed Enums

**PROPOSAL ONLY — NOT IMPLEMENTED.**

```prisma
// PROPOSAL ONLY — NOT IMPLEMENTED
enum RideDriverApplicationStatus  { DRAFT SUBMITTED UNDER_REVIEW APPROVED REJECTED WITHDRAWN }
enum RideIdentifierMigrationState { CURRENT LEGACY_PENDING_REVERIFICATION LEGACY_UNRECOVERABLE }
enum RideVehicleOwnershipStatus   { ACTIVE RETIRED TRANSFERRED SUSPENDED }
enum RideVehicleTransferStatus    { PENDING APPROVED REJECTED CANCELLED }
```

Seluruhnya enum **baru**, sehingga menghindari risiko `ALTER TYPE … ADD VALUE` di dalam transaksi (§23 butir 4). `RideDriverStatus`, `RideDriverAvailability`, dan `RideVehicleVerificationStatus` yang sudah ada **tidak diubah**.

---

## 12. Proposed Constraints and Indexes

**PROPOSAL ONLY — NOT IMPLEMENTED.**

| Objek | Jenis | Tujuan | Definisi |
|---|---|---|---|
| `ride_driver_applications_one_open_per_user_key` | partial unique | satu open cycle per user | §6.3 |
| `ride_driver_applications_license_blind_index_key` | partial unique | satu SIM satu identitas (D-22) | §6.3 |
| `ride_driver_applications_terminal_timestamp_check` | CHECK | timestamp hanya pada status terkait | §6.3 |
| `ride_driver_applications_license_required_check` | CHECK | `SUBMITTED` ke atas wajib identitas SIM lengkap | §6.3 |
| `(userId, cycleNumber)` | unique | urutan cycle deterministik | §6.2 |
| `(status, createdAt)`, `(status, claimExpiresAt)` | index | antrean review & sweep lease | §6.2, §7.1 |
| `ride_vehicle_ownerships_one_active_per_vehicle_key` | partial unique | satu ownership aktif per kendaraan | §8.3 |
| `ride_vehicles_plate_blind_index_key` | partial unique | identitas plat unik per key version | §8.3 |
| `ride_vehicle_ownerships_ended_at_check` | CHECK | histori tidak dapat ditulis ulang | §8.3 |
| `ride_vehicle_ownerships_active_requires_verified_check` | CHECK | `isActive` hanya bila `VERIFIED` | §8.3 |

**Catatan implementasi:** Prisma tidak mendukung partial unique index maupun CHECK constraint secara deklaratif. Seluruh objek di atas dibuat lewat **raw SQL pada file migration**, dan didokumentasikan dengan komentar `///` pada model agar tidak hilang saat `prisma format`. Drift check wajib setiap migrasi (§23 butir 5).

---

## 13. Proposed HMAC Interfaces

**PROPOSAL ONLY — NOT IMPLEMENTED.**

Definisi interface ada di §9.2. Kontrak pendukung:

| Elemen | Bentuk |
|---|---|
| Domain | `"nik" \| "sim" \| "plate" \| "stnk"` — `stnk` fail-closed sampai keputusan dokumen |
| Nilai index | hex HMAC-SHA256, panjang tetap 64 karakter → kolom `VarChar(64)` |
| Metadata wajib per baris | `keyVersion Int`, `canonVersion Int`, `indexMigrationState` |
| Perbandingan | `timingSafeEqual` untuk `verifyIndex` |
| Env (nama saja) | `IDENTIFIER_INDEX_KEY_CURRENT_VERSION`, `IDENTIFIER_INDEX_KEY_V1`, `IDENTIFIER_INDEX_KEY_V2` |
| Kegagalan | fail-closed pada kunci hilang / versi tak dikenal / domain terlarang |

---

## 14. Authorization Matrix

Lihat §7.4 untuk review lease. Ringkasan lintas batch:

| Operasi | Applicant | Reviewer ber-scope | Senior reviewer | ADMIN tanpa scope | SUPER_ADMIN tanpa scope | Driver capability |
|---|---|---|---|---|---|---|
| Buat/edit/submit/withdraw aplikasi | ✅ miliknya | ❌ | ❌ | ❌ | ❌ | tidak relevan |
| Baca antrean review | ❌ | ✅ `driver.review.read` | ✅ | ❌ | ❌ | — |
| Claim/renew/release | ❌ | ✅ `driver.review.claim` | ✅ | ❌ | ❌ | — |
| Reassign | ❌ | ❌ | ✅ `driver.review.reassign` | ❌ | ❌ | — |
| Approve/reject | ❌ | ✅ `driver.review.decide` | ✅ | ❌ | ❌ | — |
| Review transfer kendaraan | ❌ | ✅ `vehicle.transfer.review` | ✅ | ❌ | ❌ | — |
| Route operasional driver | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **Stage 5.11 tidak berubah** |

---

## 15. State Transition Matrix

| Dari → Ke | Actor | Predikat |
|---|---|---|
| `∅ → DRAFT` | applicant | tidak ada open cycle |
| `DRAFT → DRAFT` | applicant | `version` cocok |
| `DRAFT → SUBMITTED` | applicant | field wajib lengkap |
| `DRAFT/SUBMITTED → WITHDRAWN` | applicant | status masih open dan belum `UNDER_REVIEW` |
| `SUBMITTED → UNDER_REVIEW` | reviewer | unclaimed atau lease expired |
| `UNDER_REVIEW → SUBMITTED` | pemilik claim / expiry / reassign | — |
| `UNDER_REVIEW → APPROVED` | pemilik claim hidup | + `upsert RideDriverProfile` |
| `UNDER_REVIEW → REJECTED` | pemilik claim hidup | `reasonCode` wajib |
| Terminal (`APPROVED`/`REJECTED`/`WITHDRAWN`) | — | **tidak ada transisi keluar** |

`SUSPENDED` **bukan** status aplikasi; tetap milik `RideDriverProfile` dengan `assertDriverModerationTransition` yang sudah ada (E-12).

---

## 16. Transaction and Concurrency Design

- **Isolation:** Read Committed (default), konsisten E-11 dan pelajaran Stage 5.7. **Jangan** memperkenalkan Serializable.
- **Single-winner:** conditional update + pemeriksaan `count`/`RETURNING`; kalah → 409 spesifik.
- **Optimistic lock:** kolom `version` pada aplikasi dan transfer.
- **Waktu:** `now()` database; statement yang memerlukannya memakai `$executeRaw` di dalam `$transaction`.
- **Idempotensi:** `RideIdempotencyRecord` (E-05) dengan scope baru `driver_application_submit`, `vehicle_transfer_request`.
- **Atomisitas approval:** update aplikasi + upsert profil + audit dalam satu transaksi; gagal salah satu → rollback semua.
- **Retry:** hanya untuk error transient yang sudah terbukti (`P2034`/`40001`), tanpa memperluas kelas error.

---

## 17. Audit Event Catalogue

`entityType`: `RideDriverApplication`, `RideVehicleOwnership`, `RideVehicleTransfer`. `metadata` **dilarang** memuat raw identifier, blind index, atau teks bebas berisi PII — hanya `reasonCode`, status lama→baru, dan id.

`driver_application.created` · `.updated` · `.submitted` · `.withdrawn` · `.claimed` · `.renewed` · `.released` · `.claim_expired` · `.reassigned` · `.approved` · `.rejected`
`ride_driver_profile.created` · `.activated_from_application`
`ride_vehicle.registered` · `ride_vehicle_ownership.started` · `.retired` · `.transferred` · `.suspended`
`ride_vehicle_transfer.requested` · `.approved` · `.rejected` · `.conflict`
`identifier.legacy_key_lookup` · `identifier.unknown_key_version` · `identifier.migrated` · `identifier.collision_detected`

---

## 18. Error Code Catalogue

| Code | HTTP | Kondisi |
|---|---|---|
| `RIDE_DRIVER_APPLICATION_NOT_FOUND` | 404 | tidak ada / bukan milik pemanggil |
| `RIDE_DRIVER_APPLICATION_ALREADY_OPEN` | 409 | sudah ada cycle open |
| `RIDE_DRIVER_APPLICATION_INVALID_STATE` | 409 | transisi tidak sah |
| `RIDE_DRIVER_APPLICATION_NOT_EDITABLE` | 409 | bukan `DRAFT` |
| `RIDE_DRIVER_APPLICATION_INCOMPLETE` | 400 | field wajib belum lengkap |
| `RIDE_DRIVER_APPLICATION_STALE_VERSION` | 409 | optimistic lock gagal |
| `RIDE_DRIVER_APPLICATION_ALREADY_CLAIMED` | 409 | claim aktif milik reviewer lain |
| `RIDE_DRIVER_APPLICATION_CLAIM_EXPIRED` | 409 | lease habis |
| `RIDE_DRIVER_APPLICATION_CLAIM_NOT_OWNED` | 409 | bukan pemegang claim |
| `RIDE_DRIVER_APPLICATION_DECISION_FINAL` | 409 | sudah terminal |
| `RIDE_SCOPE_REQUIRED` | 403 | scope eksplisit tidak dimiliki |
| `RIDE_DRIVER_PROFILE_ALREADY_EXISTS` | 409 | profil sudah ada saat approval non-idempotent |
| `RIDE_VEHICLE_PLATE_TAKEN` | 409 | plat sudah punya ownership aktif |
| `RIDE_VEHICLE_OWNERSHIP_NOT_ACTIVE` | 409 | ownership tidak aktif |
| `RIDE_VEHICLE_TRANSFER_CONFLICT` | 409 | transfer paralel |
| `RIDE_IDENTIFIER_ALREADY_REGISTERED` | 409 | blind index bentrok (SIM, D-22) |
| `RIDE_IDENTIFIER_FORMAT_INVALID` | 400 | canonicalization gagal |
| `RIDE_IDENTIFIER_KEY_UNAVAILABLE` | 503 | kunci hilang → fail-closed |

Kode Stage 5.11 (`RIDE_DRIVER_PROFILE_REQUIRED`, `RIDE_DRIVER_NOT_ACTIVE`, `RIDE_DRIVER_ACCOUNT_INACTIVE`) **tidak berubah**.

---

## 19. Cross-Batch Dependency Map

| Kebutuhan | Bergantung pada | Alasan berbasis repository |
|---|---|---|
| `RideDriverApplication.licenseBlindIndex` + `licenseKeyVersion` + `licenseCanonVersion` (Batch 1) | **Batch 4** | Kolom tidak dapat diisi tanpa layanan index; menulis schema lebih dulu memaksa keputusan format tanpa implementasi yang memvalidasi |
| Unique SIM lintas versi (D-22) | **Batch 4** | Deduplication lintas versi ditegakkan lewat dual lookup di application layer, bukan oleh index tunggal |
| `RideVehicle.plateBlindIndex` + versi (Batch 3) | **Batch 4** | Idem |
| Update `PrismaMatchingAdapter` (Batch 3) | Batch 3 schema | E-13 — konsumen existing wajib ikut berubah |
| Guard `requireScopes` (Batch 2) | Model penyimpanan scope | **BLOCKED** — belum ada di repo (G-12) |
| Approval membuat profil (Batch 1) | `RideDriverProfile` existing | E-01 — `userId @unique` memungkinkan upsert aman |
| Seluruh batch | Stage 5.11 capability guard | **Tidak boleh diubah**; kapabilitas tetap dari `User.status` + `RideDriverProfile.status`, tanpa cache |
| Endpoint HTTP | Batch 1–4 selesai | Endpoint adalah stage terpisah, bukan bagian Batch 1–4 |

**Feature flag:** karena Batch 1–4 tidak memasang endpoint, tidak ada permukaan publik yang perlu di-flag. Flag baru diperlukan saat endpoint diaktifkan (stage berikutnya).

---

## 20. Recommended Implementation Order

**Urutan yang direkomendasikan: 4 → 1 → 2 → 3**, bukan 1 → 2 → 3 → 4.

| Urutan | Batch | Alasan |
|---|---|---|
| 1 | **Batch 4 — HMAC service** | Tidak bergantung schema; menyediakan kontrak kolom (`blindIndex` panjang 64 hex, `keyVersion`, `canonVersion`) yang dibutuhkan Batch 1 dan 3. Dapat diuji penuh secara unit tanpa database |
| 2 | **Batch 1 — Schema aplikasi** | Memakai kontrak Batch 4; menyediakan entitas yang dibutuhkan Batch 2 |
| 3 | **Batch 2 — Review lease** | Menambah kolom pada tabel Batch 1; logika paling padat konkurensi |
| 4 | **Batch 3 — Vehicle ownership** | Paling berisiko karena mengubah konsumen existing (`PrismaMatchingAdapter`); dikerjakan terakhir agar kegagalannya tidak memblokir jalur onboarding |

---

## 21. File-by-File Change Plan

**Tidak ada file yang boleh diubah pada task planning ini selain dokumen Stage 5.13.** Daftar di bawah adalah perkiraan untuk stage implementasi.

### Akan dibuat (proposed path)

| Path | Batch | Tujuan | Risiko | Validation | Test coverage |
|---|---|---|---|---|---|
| `src/core/security/identifierIndex.ts` | 4 | Blind index service | Salah canonicalization merusak deduplication | unit + startup check | Unit lengkap §22 |
| `src/core/security/identifierKeyRegistry.ts` | 4 | Registry kunci + fail-closed | Kunci hilang → boot gagal (disengaja) | startup | Unit |
| `src/modules/rides/domain/driverApplicationStateMachine.ts` | 1 | `assertApplicationTransition` | — | unit | Unit matriks transisi |
| `src/modules/rides/application/DriverApplicationService.ts` | 1,2 | Service aplikasi + lease | Konkurensi | integration | Integration |
| `src/modules/rides/application/VehicleOwnershipService.ts` | 3 | Ownership + transfer | Konkurensi | integration | Integration |
| `prisma/migrations/2026…_driver_application_foundation/migration.sql` | 1 | Tabel + partial unique + CHECK | SQL manual | disposable DB | Migration test |
| `prisma/migrations/2026…_driver_review_lease/migration.sql` | 2 | Kolom lease | additive | disposable DB | — |
| `prisma/migrations/2026…_vehicle_ownership_foundation/migration.sql` | 3 | Ownership/transfer + kolom plat | additive | disposable DB | — |
| `tests/rides/driverApplication*.integration.test.ts` | 1,2 | — | — | — | §22 |
| `tests/rides/vehicleOwnership.integration.test.ts` | 3 | — | — | — | §22 |
| `tests/security/identifierIndex.test.ts` | 4 | — | — | — | §22 |

### Akan diubah

| Path | Batch | Perubahan | Risiko |
|---|---|---|---|
| `prisma/schema.prisma` | 1,2,3 | Model/enum/kolom additive + komentar deprecated legacy | Drift bila partial index tidak sinkron |
| `src/config/env.ts` | 4 | Nama env kunci + validasi + startup check | Boot gagal bila kunci belum diset — **disengaja** |
| `src/core/logger/logger.ts` | 4 | Tambah `redact.paths` identifier | Rendah |
| `src/modules/rides/infrastructure/PrismaMatchingAdapter.ts` | 3 | Filter lewat ownership | **Tinggi** — test `rideFoundation` harus tetap hijau |
| `src/modules/rides/presentation/ride.routes.ts` | 2,3 | Komposisi service baru (tanpa endpoint baru) | Rendah |

### Tidak boleh disentuh

`src/modules/rides/presentation/driverCapability.ts` (Stage 5.11) · seluruh `src/modules/{payments,memberships,referrals,wallets,profit-sharing}` · `apps/user_app` · `apps/driver_app` · migrasi existing · model legacy (selain komentar) · 21 untracked owner assets.

---

## 22. Test Matrix

| # | Test | Jenis | Fixture | Expected | Error code | Isolation proof |
|---|---|---|---|---|---|---|
| **Batch 1** |
| T1.1 | Satu open application per user | integration/DB | user + aplikasi `DRAFT` | create kedua ditolak | `…ALREADY_OPEN` | — |
| T1.2 | Multiple historical cycles | integration | `REJECTED` lalu create baru | sukses, `cycleNumber` naik | — | — |
| T1.3 | `WITHDRAWN` terminal | integration | aplikasi `WITHDRAWN` | semua transisi ditolak | `…INVALID_STATE` | — |
| T1.4 | Duplicate submit | integration | `DRAFT` | submit kedua idempoten 200 | — | — |
| T1.5 | Concurrent submit | concurrency | 2 request paralel | tepat satu transisi, satu audit | — | — |
| T1.6 | Approve idempotency | integration | approve 2× | satu profil, satu audit | — | — |
| T1.7 | Approve vs withdraw race | concurrency | `UNDER_REVIEW` | withdraw ditolak, approve menang | `…INVALID_STATE` | — |
| T1.8 | Passenger capability tidak berubah | integration | user dengan aplikasi | quote/list tetap 200 | — | ✅ |
| T1.9 | Nol mutasi finansial | integration | snapshot before/after | identik | — | ✅ **wajib** |
| **Batch 2** |
| T2.1 | Concurrent claim | concurrency | 2 reviewer | tepat satu menang | `…ALREADY_CLAIMED` | — |
| T2.2 | Expired claim takeover | integration/DB | lease lewat | reviewer lain berhasil claim | — | — |
| T2.3 | Renewal | integration | pemilik claim | `claimExpiresAt` maju | — | — |
| T2.4 | Release | integration | pemilik claim | kembali `SUBMITTED` | — | — |
| T2.5 | Stale reviewer decision | integration | lease habis lalu decide | ditolak | `…CLAIM_EXPIRED` | — |
| T2.6 | Unauthorized reassignment | integration | reviewer tanpa scope | ditolak | `RIDE_SCOPE_REQUIRED` | — |
| T2.7 | ADMIN/SUPER_ADMIN tanpa scope | integration | token ADMIN | ditolak semua operasi review | `RIDE_SCOPE_REQUIRED` | — |
| T2.8 | Duplicate final decision | concurrency | 2 approve paralel | satu menang | `…DECISION_FINAL` | — |
| T2.9 | Database time authority | integration/DB | ubah jam proses Node | perilaku lease tidak berubah | — | — |
| **Batch 3** |
| T3.1 | One active ownership | integration/DB | 2 ownership `ACTIVE` | insert kedua gagal | `RIDE_VEHICLE_PLATE_TAKEN` | — |
| T3.2 | Transfer atomik | integration | transfer approve | lama `TRANSFERRED`, baru `ACTIVE`, 1 audit | — | — |
| T3.3 | Transfer race | concurrency | 2 transfer paralel | satu menang | `…TRANSFER_CONFLICT` | — |
| T3.4 | Retired vehicle | integration | retire | `isActive=false`, tidak dapat order | — | — |
| T3.5 | Replaced vehicle | integration | plat baru | kendaraan lama utuh | — | — |
| T3.6 | Historical `RideOrder` | integration | order lama + transfer | `vehicleId` tetap menunjuk kendaraan saat trip | — | — |
| T3.7 | Suspended vehicle ≠ suspended driver | integration | ownership `SUSPENDED` | passenger & driver capability tidak berubah | — | ✅ |
| T3.8 | Nol reuse legacy hash | static/unit | grep | `plateNumberHash` tidak dipakai jalur baru | — | — |
| T3.9 | Matching tetap benar | integration | `rideFoundation` | 39 test tetap hijau | — | — |
| **Batch 4** |
| T4.1 | Deterministik domain/key sama | unit | vektor sintetis | index identik | — | — |
| T4.2 | Domain separation | unit | nilai sama, domain beda | index berbeda | — | — |
| T4.3 | Version separation | unit | key v1 vs v2 | index berbeda | — | — |
| T4.4 | Canonicalization | unit | `z 0001 zz` vs `Z-0001-ZZ` | index sama | — | — |
| T4.5 | Leading zero preserved | unit | `0000000000000001` | tidak jadi `1` | — | — |
| T4.6 | Format invalid | unit | NIK 3 digit | ditolak | `…FORMAT_INVALID` | — |
| T4.7 | Missing key fail-closed | unit | registry kosong | throw saat startup | — | — |
| T4.8 | Unknown version fail-closed | unit | `keyVersion=9` | ditolak + audit | — | — |
| T4.9 | Dual lookup | integration | baris v1, write key v2 | tetap ditemukan | — | — |
| T4.10 | Lazy migration | integration | resubmission sah | index naik ke v2, raw tidak tersimpan | — | — |
| T4.11 | Old-key audit event | integration | fallback | `identifier.legacy_key_lookup` terbit | — | — |
| T4.12 | Nol raw/index di log & error | integration | log capture | nol kemunculan | — | ✅ |
| T4.13 | `stnk` fail-closed | unit | panggil domain `stnk` | ditolak | — | — |
| **Keamanan lintas batch** |
| TS.1 | Nol upload dokumen | static | grep | nol endpoint/model dokumen | — | ✅ |
| TS.2 | Nol PII nyata di fixture | static | grep | hanya sintetis | — | ✅ |
| TS.3 | Nol secret exposure | static | secret scan | bersih | — | ✅ |
| TS.4 | Nol admin bypass | integration | Stage 5.11 suite | 13 test tetap hijau | — | ✅ |
| TS.5 | Nol provider call | static | grep | nol `axios`/`fetch` eksternal | — | ✅ |
| TS.6 | Nol mutasi finansial | integration | snapshot | identik | — | ✅ |

---

## 23. Migration Safety Plan

1. **Urutan:** Batch 4 tidak butuh migrasi. Lalu `driver_application_foundation` → `driver_review_lease` → `vehicle_ownership_foundation`.
2. **Additive-first:** hanya `CREATE TABLE`, `CREATE TYPE`, `ADD COLUMN` nullable, `CREATE INDEX`. **Nol** `DROP`/`ALTER COLUMN` pada tabel lama.
3. **Nullable-before-required:** seluruh kolom baru pada tabel existing (`RideVehicle`) nullable; tidak ada `NOT NULL` retro.
4. **Risiko enum rollout:** menambah **nilai** ke enum PostgreSQL yang sudah ada tidak dapat berjalan di dalam transaksi pada beberapa versi. Rencana ini hanya membuat enum **baru**, sehingga risiko tersebut dihindari. Bila kelak perlu menambah nilai, wajib migrasi terpisah.
5. **Partial unique & CHECK:** raw SQL; `prisma migrate diff` harus diperiksa agar tidak menghasilkan drift.
6. **Transaction safety:** Prisma menjalankan tiap migrasi dalam satu transaksi; `CREATE INDEX` non-concurrent mengunci tabel — dapat diterima karena tabel baru/kosong.
7. **Lock impact & timeout:** minimal pada tabel baru. Untuk `ADD COLUMN` pada `ride_vehicles`, PostgreSQL 11+ tidak menulis ulang tabel untuk kolom nullable tanpa default → aman.
8. **Bukti tabel kosong:** dokumen ini mencatat **nol jalur pembuatan** `RideVehicle` di kode. **Itu bukan bukti tabel produksi kosong.** Saat implementasi **wajib** menjalankan `SELECT count(*)` pada environment target dan mencatat hasilnya. Jangan menganggap rollback aman hanya karena kode tidak pernah menulis.
9. **Legacy isolation:** hanya komentar `///`; nol perubahan struktur.
10. **Rollback limitation:** Prisma tidak punya down-migration. Rollback nyata = **forward-fix migration** yang men-`DROP` objek baru, dan hanya sah bila `count = 0` terverifikasi.
11. **Validasi:** PostgreSQL disposable; `prisma migrate deploy` dari database kosong; `prisma migrate status`; drift check; full suite.
12. **Production rollout belum diizinkan.**

---

## 24. Rollback and Forward-Fix Plan

| Batch | Rollback | Forward-fix |
|---|---|---|
| 4 | Revert commit; nol dampak DB | Perbaiki service; index lama tetap valid selama key registry tidak berubah |
| 1 | Revert commit; tabel baru tidak dipakai | Migrasi `DROP TABLE` bila `count=0` terverifikasi |
| 2 | Revert commit; kolom nullable tetap ada tanpa efek | Migrasi `DROP COLUMN` bila kosong |
| 3 | **Paling berisiko** — `PrismaMatchingAdapter` berubah | Revert kode adapter lebih dulu, baru pertimbangkan DROP objek |

Aturan: **jangan pernah** `prisma migrate resolve --rolled-back` pada environment yang sudah menerapkan migrasi; selalu forward-fix.

---

## 25. Security Isolation Proof

Yang harus dibuktikan setiap checkpoint: nol endpoint baru pada Batch 1–4 · nol model/kolom dokumen · nol integrasi provider · nol secret di source · nol raw identifier tersimpan · nol raw/blind index di log · Stage 5.11 capability guard tidak berubah dan 13 test-nya tetap hijau · nol bypass admin · nol data KYC nyata di fixture.

---

## 26. Financial/Business Engine Isolation

Batch 1–4 **tidak menyentuh** `payments`, `memberships`, `referrals`, `wallets`, `profit-sharing`, PPOB, maupun formula apa pun. Bukti wajib per checkpoint: snapshot `wallet`/`walletTransaction`/`commission`/`rewardTransaction`/`withdrawal` (count + agregat) **identik** sebelum dan sesudah, mengikuti pola yang sudah dipakai di `driverCapability.integration.test.ts` dan D9 `rideAdminModerationHardening`.

---

## 27. Legacy Model Isolation

`Driver`, `DriverDocument`, `DriverEarning`, `WithdrawalRequest`, `Ride` legacy: **nol referensi** di `src/` dan `tests/` (terverifikasi). Tindakan Batch 1: tambahkan komentar `///` `@deprecated — jangan dipakai untuk implementasi baru (Owner Decision 8)`. **Tanpa** penghapusan tabel/model/migrasi (D-23 PENDING). Kolom `RideVehicle.plateNumberHash` dan `RideVehicle.driverProfileId` juga ditandai deprecated pada Batch 3, tetapi tetap ada.

---

## 28. Implementation Checkpoints

| Checkpoint | Objective | Allowed files | Forbidden | Acceptance | Validation | Commit subject | STOP condition |
|---|---|---|---|---|---|---|---|
| **5.14A** HMAC service | Blind index service + key registry + startup fail-closed | `src/core/security/identifierIndex.ts`, `identifierKeyRegistry.ts`, `src/config/env.ts`, `logger.ts`, `tests/security/identifierIndex.test.ts` | schema, migration, endpoint | T4.1–T4.8, T4.12, T4.13 hijau | `tsc`, lint, build, targeted, full suite | `feat(security): add versioned identifier blind index service` | Bila canonicalization SIM tidak dapat ditetapkan tanpa bukti → STOP |
| **5.14B** Schema aplikasi | `RideDriverApplication` + enum + partial unique + CHECK + state machine + service dasar | `prisma/schema.prisma`, migrasi baru, `domain/driverApplicationStateMachine.ts`, `application/DriverApplicationService.ts`, test | endpoint, dokumen, lease | T1.1–T1.9 hijau; migrate deploy bersih | + `prisma validate/generate`, fresh `migrate deploy`, `migrate status`, drift check | `feat(ride): add driver application foundation` | Bila `count(*)` tabel target tidak dapat diverifikasi → STOP |
| **5.14C** Review lease | Kolom lease + transaksi claim/renew/release/reassign/decision + audit | kolom pada model Batch 1, migrasi, service, test | endpoint, akses dokumen, guard scope bila model scope belum disetujui | T2.1–T2.9 hijau | idem | `feat(ride): add driver application review lease` | **CONDITIONAL** — bila model penyimpanan scope belum disetujui, guard scope ditunda dan dicatat |
| **5.14D** Vehicle ownership | Ownership/transfer + kolom plat + update matching adapter | schema, migrasi, `VehicleOwnershipService.ts`, `PrismaMatchingAdapter.ts`, test | model dokumen kendaraan, verifikasi dokumen | T3.1–T3.9 hijau; `rideFoundation` 39 test tetap hijau | idem | `feat(ride): add temporal vehicle ownership` | Bila verifikasi dokumen dianggap wajib oleh Owner → STOP |

Setiap checkpoint: **full backend suite wajib hijau, 0 skipped**, dijalankan pada PostgreSQL disposable, diakhiri **Owner Review gate** sebelum checkpoint berikutnya.

---

## 29. Stage 5.14 Entry Criteria

1. Owner menyetujui dokumen Stage 5.13 ini.
2. Owner mengonfirmasi **urutan 4 → 1 → 2 → 3**.
3. Owner memutuskan apakah guard scope (model `AdminScopeGrant`) masuk 5.14C atau ditunda.
4. Owner mengonfirmasi bahwa snapshot atribut kendaraan pada `RideOrder` (§8.1 no. 15) boleh ditambahkan, atau ditunda.
5. Owner mengonfirmasi D-20 tetap tanpa cooldown untuk sementara.
6. Baseline branch `agent/tapgo-release2-driver` tidak berubah.

---

## 30. Risks, Blockers, and STOP Conditions

| # | Item | Jenis | Tindakan |
|---|---|---|---|
| B-1 | Verifikasi dokumen kendaraan pada transfer (D-18) | **BLOCKED — OWNER DECISION REQUIRED** | Batch 3 berhenti pada transfer tanpa verifikasi dokumen |
| B-2 | Model penyimpanan/pemberian scope | **BLOCKED — OWNER DECISION REQUIRED** | 5.14C conditional |
| B-3 | Penyimpanan raw NIK/SIM (D-04) | **BLOCKED** | Hanya blind index + masked |
| B-4 | Kelengkapan dokumen sebagai syarat `SUBMITTED` (D-07) | **BLOCKED** | Validasi non-dokumen saja |
| B-5 | Cooldown resubmit (D-20) | PENDING | **Tidak diterapkan**, dinyatakan eksplisit |
| B-6 | Snapshot kendaraan pada `RideOrder` | Perlu persetujuan | Menyentuh tabel di luar Batch 3 murni |
| R-1 | `PrismaMatchingAdapter` berubah | Risiko tinggi | `rideFoundation` 39 test wajib tetap hijau |
| R-2 | Bukti tabel kosong hanya dari kode | Risiko | `SELECT count(*)` wajib saat implementasi |
| R-3 | Unique SIM per `keyVersion` | Risiko desain | Dedup lintas versi lewat dual lookup; test wajib |
| R-4 | Prisma tidak mendukung partial unique | Risiko drift | Raw SQL + drift check tiap migrasi |
| R-5 | `now()` tidak dapat diekspresikan Prisma builder | Risiko implementasi | `$executeRaw` di dalam `$transaction` — dicatat, bukan diputuskan saat coding |

---

## 31. Files Inspected

Daftar file yang dibaca read-only (bukan snippet kode; nol nilai secret dibaca atau dicetak):

```text
apps/backend/prisma/schema.prisma
apps/backend/prisma/migrations/  (daftar + 0016_founder_chairman_unique_guard, 20260729120000_ride_domain_foundation)
apps/backend/src/config/env.ts                     (nama variabel saja)
apps/backend/src/core/logger/logger.ts
apps/backend/src/core/security/authContext.ts
apps/backend/src/core/security/rateLimit.ts
apps/backend/src/lib/doku/signature.ts
apps/backend/src/modules/rides/application/RideService.ts
apps/backend/src/modules/rides/domain/rideStateMachine.ts
apps/backend/src/modules/rides/infrastructure/PrismaMatchingAdapter.ts
apps/backend/src/modules/rides/presentation/ride.routes.ts
apps/backend/src/modules/rides/presentation/driverCapability.ts
apps/backend/tests/helpers/referralWalletHarness.ts
apps/backend/tests/rides/
docs/release-2/STAGE_5_12_DRIVER_ONBOARDING_ARCHITECTURE.md
```

---

## 32. Final GO/NO-GO Recommendation

| Checkpoint | Rekomendasi | Alasan |
|---|---|---|
| **5.14A** HMAC service | **GO** | Nol prasyarat terbuka; dapat diuji penuh secara unit; menjadi fondasi Batch 1 & 3 |
| **5.14B** Schema aplikasi | **GO** | Seluruh keputusan pemblokir sudah APPROVED; D-20 dinyatakan eksplisit tidak diterapkan; bukti `count(*)` wajib saat eksekusi |
| **5.14C** Review lease | **CONDITIONAL GO** | Logika dan transaksi dapat dikerjakan; **guard scope ditunda** sampai B-2 diputuskan |
| **5.14D** Vehicle ownership | **CONDITIONAL GO** | Ownership + transfer dapat dikerjakan; **verifikasi dokumen kendaraan tetap NO-GO** (B-1); risiko `PrismaMatchingAdapter` harus diterima secara sadar |
| Endpoint HTTP, dokumen, S3/KMS, scanner, UI driver | **NO-GO** | Tetap diblokir |

**Stage 5.13 belum disetujui. Stage 5.14 belum dimulai.**

---

*Akhir dokumen.*
