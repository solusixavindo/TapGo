# Stage 5.12 — Driver Onboarding Architecture & Document Security Decision

> **PROPOSAL ONLY — NOT IMPLEMENTED.**
> Seluruh schema, API, enum, error code, dan kebijakan dalam dokumen ini adalah usulan.
> Tidak ada source code, Prisma schema, migration, test, atau infrastruktur yang diubah pada Stage 5.12.

| | |
|---|---|
| Branch | `agent/tapgo-release2-driver` |
| Baseline | `ea5b5a5d2740342460604bd9d32960398cd5bca5` |
| Stage | 5.12 — design & decision package |
| Status | menunggu Owner Review |

---

## 1. Executive Summary

Stage 5.11 sudah menutup lubang otorisasi driver: kewenangan kini berasal dari database (`User.status` + `RideDriverProfile.status`), bukan dari klaim role pada JWT. Yang belum ada adalah **cara sah untuk menjadi driver**. Audit membuktikan **nol** jalur produksi yang membuat `RideDriverProfile` maupun `RideVehicle` — kedua tabel hanya pernah diisi oleh test.

Dokumen ini mengusulkan arsitektur onboarding end-to-end yang aman, dengan lima keputusan arsitektur utama:

1. **Onboarding sebagai entitas terpisah** (`RideDriverApplication`), bukan memperluas `RideDriverProfile`. Profil hanya lahir saat approval, sehingga tidak ada state setengah jadi yang bisa disalahartikan sebagai kapabilitas.
2. **Review claim berbasis lease** dengan `claimExpiresAt`, conditional update, dan reassignment aman — mencegah dua admin mereview aplikasi yang sama sekaligus mencegah aplikasi terkunci permanen.
3. **Vehicle ownership temporal** (`RideVehicleOwnership`) dengan partial unique index untuk "satu active ownership per plate", sehingga plat dapat berpindah secara sah tanpa kehilangan histori dan tanpa merusak `RideOrder` lama.
4. **Blind index HMAC-SHA256 berkunci** dengan domain separation dan key versioning untuk NIK/SIM/STNK/plat — memisahkan tegas antara *lookup*, *encryption*, *masking*, dan *redaction*.
5. **Private object storage** untuk dokumen. Rekomendasi: **Cloudflare R2** (runner-up: **AWS S3 ap-southeast-3 Jakarta**) — dengan catatan bahwa pilihan final bergantung pada keputusan data residency yang **belum** dapat dibuktikan dari repository.

**Temuan paling penting:** `CLOUDINARY_*` sudah dideklarasikan di `env.ts` tetapi **tidak dipakai kode mana pun**. Cloudinary adalah media CDN yang public-by-default dan **tidak layak** untuk dokumen KYC. Deklarasi ini harus tidak dipakai untuk onboarding dan sebaiknya dibersihkan pada stage terpisah.

**Rekomendasi Go/No-Go: GO untuk Batch 1–4 Stage 5.13** (schema foundation, review lease, vehicle ownership, HMAC service) — keempatnya tidak menyentuh dokumen. **NO-GO untuk Batch 5 ke atas** sampai Owner menjawab decision register (khususnya D-01 s.d. D-06).

---

## 2. Repository Evidence

Seluruh temuan di bawah berasal dari pembacaan repository pada `ea5b5a5`, bukan asumsi. **Tidak ada nilai secret yang dibaca atau dicetak** — hanya nama environment variable.

### 2.1 Model driver & kendaraan aktif

| File | Symbol | Kondisi saat ini | Gap | Dampak ke Stage 5.13 |
|---|---|---|---|---|
| `prisma/schema.prisma:1186` | `RideDriverProfile` | `userId @unique`, `status` default `PENDING`, `availability`, rating, `onDelete: Cascade` | Tidak ada field onboarding (pengajuan, reviewer, alasan, dokumen) | Butuh entitas aplikasi terpisah; profil jangan dijadikan form pengajuan |
| `prisma/schema.prisma:1206` | `RideVehicle` | `plateNumberHash` (SHA-256 **unsalted**), `plateNumberMasked`, `verificationStatus`, `isActive` default `false`, `@@unique([driverProfileId, plateNumberHash])` | Tidak ada konsep kepemilikan temporal, transfer, atau retire. Unique hanya per-driver sehingga dua driver bisa mengklaim plat sama | Butuh `RideVehicleOwnership` + partial unique index; hash harus diganti HMAC |
| `prisma/schema.prisma:1099-1116` | `RideDriverStatus`, `RideDriverAvailability`, `RideVehicleVerificationStatus` | `PENDING/ACTIVE/SUSPENDED/REJECTED`, `OFFLINE/ONLINE/BUSY`, `PENDING/VERIFIED/REJECTED` | Cukup untuk kapabilitas, tidak cukup untuk siklus review | Enum profil **dipertahankan**; enum baru hanya untuk aplikasi |

### 2.2 Bukti: nol jalur pembuatan profil/kendaraan

| Operasi | `rideDriverProfile` | `rideVehicle` |
|---|---|---|
| `create` | **0** | **0** |
| lainnya | `findMany` ×2, `findUnique` ×3, `findUniqueOrThrow` ×1, `update` ×2, `updateMany` ×2 | `findFirst` ×1, `findMany` ×1, `findUnique` ×2, `findUniqueOrThrow` ×1, `updateMany` ×1 |

**Dampak:** onboarding adalah greenfield. Tidak ada perilaku produksi yang bisa rusak, dan tidak ada backfill yang wajib.

### 2.3 Model legacy — orphaned sepenuhnya

| Model | Baris | Kondisi | Pemakaian di `src/` | Pemakaian di `tests/` |
|---|---|---|---|---|
| `Driver` | 606 | `licenseNumber @unique` (plaintext), `vehiclePlate` (plaintext), `kycStatus` | **0** | **0** |
| `DriverDocument` | 633 | `url` (String, tanpa jaminan privat), `status`, `reviewedBy/At` | **0** | **0** |
| `DriverEarning` | 848 | — | **0** | **0** |
| `WithdrawalRequest` | 863 | `bankAccount` Json | **0** | **0** |
| `Ride` (legacy) | ~656 | `customerId` RESTRICT, alamat & koordinat plaintext | **0** | **0** |
| enum `DriverStatus`, `KycStatus` | 24, 31 | — | **0** | **0** |

**Gap:** `Driver.licenseNumber` dan `Driver.vehiclePlate` menyimpan identifier sensitif sebagai **plaintext**, dan `DriverDocument.url` tidak menjamin privasi. Ini persis anti-pola yang dilarang Owner Decision 9 dan 12.
**Dampak:** legacy harus ditandai deprecated (Owner Decision 8) dan **tidak boleh** menjadi basis implementasi baru. Karena nol pemakaian, tidak ada dual-read/dual-write yang perlu dijaga.

### 2.4 Audit log

| File | Kondisi | Gap |
|---|---|---|
| `prisma/schema.prisma:1048` `AuditLog` | `actorId?`, `action`, `entityType`, `entityId`, `metadata Json?`, `ipAddress`, index `[actorId,createdAt]` & `[entityType,entityId]` | Tidak ada retensi terjadwal; `metadata` bebas sehingga rawan kebocoran PII bila tidak disiplin |
| Penulis | `RideService`, `PrismaReferralRepository`, `SupportTicketService`, `PrismaMembershipRepository`, `AdminConsoleService`, `PrismaWalletRepository` | Konsisten; pola sudah teruji (test D7 membuktikan AuditLog bebas koordinat/PII mentah) |

**Dampak:** infrastruktur audit **sudah memadai** untuk onboarding; cukup menambah `action`/`entityType` baru, bukan model baru.

### 2.5 Moderasi admin yang sudah ada

| File | Kondisi | Gap |
|---|---|---|
| `ride.routes.ts:314` | `adminRideRouter.use(requireAuth, requireRoles("ADMIN","SUPER_ADMIN"))`, 8 route | Tidak ada konsep scope; semua admin setara |
| `RideService.updateDriverStatusByAdmin` | Satu transaksi: guard + conditional update + audit; menolak suspend saat driver terikat ride | Tidak ada claim/lease; dua admin bisa memoderasi bersamaan |
| `RideService:1622` `assertDriverModerationTransition` | `PENDING→{ACTIVE,SUSPENDED,REJECTED}`, `ACTIVE→{SUSPENDED,REJECTED}`, `SUSPENDED→{ACTIVE,REJECTED}`, `REJECTED→∅` | Sudah benar; dipertahankan |
| `RideService:1641` `assertVehicleModerationTransition` | `PENDING→{VERIFIED,REJECTED}`, `VERIFIED→{PENDING,REJECTED}`, `REJECTED→{PENDING}` | Sudah benar; dipertahankan |

### 2.6 Autentikasi & otorisasi

| File | Kondisi | Gap |
|---|---|---|
| `core/security/authContext.ts` | `requireAuth` verifikasi JWT; `requireRoles` mencocokkan **klaim token**, tanpa baca DB | Role tidak cocok jadi sumber kewenangan — sudah diakui dan dihindari |
| `rides/presentation/driverCapability.ts` | **Stage 5.11** — capability dari DB, tanpa bypass admin | Belum ada konsep scope reviewer |
| `AuthService` | access TTL 15m, refresh 30 hari, rotasi + deteksi reuse (`timingSafeEqual`) | Tidak ada revoke sesi massal saat status berubah (disengaja, Owner Decision 7) |
| Seluruh `src/` | **Nol** jalur yang memutasi `User.role` | Konsisten dengan Owner Decision 2 |

### 2.7 Storage, enkripsi, secret, retensi

| Aspek | Kondisi | Gap | Dampak |
|---|---|---|---|
| Object storage | **Nol** abstraksi. Nol dependency (`@aws-sdk`, `multer`, `busboy`, `minio`, dll.) | Tidak ada apa pun | Batch storage adalah greenfield penuh |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | Dideklarasikan `optional()` di `env.ts:61-63`, **nol pemakaian kode** | Media CDN public-by-default | **Tidak boleh** dipakai untuk KYC |
| Crypto primitives | `createHash` ×9, `createHmac` ×2, `randomBytes` ×7, `randomUUID` ×3, `timingSafeEqual` ×6 | Nol `createCipheriv`/`createDecipheriv` → **tidak ada kemampuan enkripsi at-rest aplikatif** | Bila raw identifier harus dapat dibaca kembali, butuh utilitas enkripsi baru |
| Pola HMAC | `lib/doku/signature.ts:69` sudah memakai `createHmac("sha256", …)` | Sudah ada preseden yang baik | Desain blind index dapat mengikuti pola ini |
| Masking | `RideService:1643` `maskPhone`; `plateNumberMasked` | Belum ada masking untuk NIK/SIM/STNK | Perlu helper masking terpusat |
| Log redaction | `core/logger/logger.ts:6` `redact.paths` mencakup authorization, cookie, password, token, signature, secret | Belum mencakup field dokumen/identifier | Perlu menambah path saat batch dokumen |
| Scheduler/retensi | **Nol** `bullmq`/`node-cron`/`agenda` | Tidak ada job retensi/deletion | Retensi otomatis butuh komponen baru |
| Account deletion | `modules/account/presentation` + `accountDeletionRequest` | Design-only; tidak menyinggung dokumen driver | Perlu diperluas saat dokumen ada |

### 2.8 Constraint, index, dan preseden partial unique

`20260729120000_ride_domain_foundation` — `ride_driver_profiles_user_id_key` (unique), `ride_vehicles_driver_profile_id_plate_number_hash_key` (unique per driver), plus index status/availability dan type/verification.

**Preseden penting:** `0016_founder_chairman_unique_guard/migration.sql` sudah memakai **partial unique index**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "founder_program_grants_one_chairman_key"
  ON "founder_program_grants" ("founder_role")
  WHERE "founder_role" = 'FOUNDER_CHAIRMAN'::"FounderRole";
```

**Dampak:** pola "hanya satu baris aktif" sudah terbukti dipakai di repo ini, sehingga usulan "satu active ownership per plate" bukan hal baru secara teknis.

### 2.9 Test & rate limiter

Test ride: `rideFoundation` (39), `rideAdminModerationHardening` (24), `driverCapability` (13 di file, 10 `it()` literal karena sebagian di-generate loop). Total suite backend 302 test.
Rate limiter tersedia: `authRateLimiter`, `registerPhoneRateLimiter`, `apiRateLimiter`, `adminRateLimiter`, `paymentRateLimiter`, `rideWriteRateLimiter`, `rideLocationRateLimiter`, `supportRateLimiter`. **Belum ada** limiter khusus onboarding/upload.

### 2.10 Environment variable (nama saja)

`NODE_ENV`, `HOST`, `PORT`, `APP_URL`, `API_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`, `CORS_ORIGINS`, `MIDTRANS_*` (5), `EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED`, `REALTIME_ENABLED`, `DOKU_*` (11), `CLOUDINARY_*` (3), `FIREBASE_PROJECT_ID`, `GOOGLE_MAPS_API_KEY`.
Pola validasi secret: `z.string().min(32)` (contoh: `JWT_ACCESS_SECRET`). **Nilai tidak dibaca.**

---

## 3. Current-State Gaps

| # | Gap | Severity | Blocking |
|---|---|---|---|
| G-1 | Tidak ada jalur pembuatan `RideDriverProfile` → tidak ada cara sah menjadi driver | Tinggi | Batch 1 |
| G-2 | Tidak ada entitas aplikasi/review; profil tidak punya reviewer, alasan, atau histori | Tinggi | Batch 1 |
| G-3 | Tidak ada claim/lease → dua admin dapat mereview bersamaan | Tinggi | Batch 2 |
| G-4 | `plateNumberHash` unik hanya per-driver → dua driver dapat mengklaim plat sama | Tinggi | Batch 3 |
| G-5 | Tidak ada kepemilikan temporal/transfer/retire kendaraan | Tinggi | Batch 3 |
| G-6 | `plateNumberHash` memakai **SHA-256 unsalted** → rentan rainbow/enumeration (ruang plat Indonesia kecil) | Tinggi | Batch 4 |
| G-7 | Legacy `Driver.licenseNumber` / `Driver.vehiclePlate` plaintext | Menengah | Batch 10 |
| G-8 | Tidak ada object storage, dependency, atau abstraksi apa pun | Tinggi | Batch 6 |
| G-9 | `CLOUDINARY_*` dideklarasikan tetapi tidak dipakai; public-by-default | Menengah | Batch 6 |
| G-10 | Tidak ada kemampuan enkripsi aplikatif (`createCipheriv` nol) | Menengah | tergantung D-04 |
| G-11 | Tidak ada scheduler → retensi/deletion tidak dapat otomatis | Menengah | Batch 6/11 |
| G-12 | Semua ADMIN setara; tidak ada scope reviewer | Menengah | Batch 8 |
| G-13 | Log redaction belum mencakup field dokumen/identifier | Menengah | Batch 5 |
| G-14 | Tidak ada limiter onboarding/upload | Rendah | Batch 5 |

---

## 4. Binding Owner Decisions

Diterima sebagai batasan yang mengikat seluruh desain di bawah:

1. Satu `User` dapat menjadi passenger sekaligus driver.
2. `User.role` tetap `USER`; role bukan sumber authorization.
3. Driver capability = `User.status = ACTIVE` **dan** `RideDriverProfile.status = ACTIVE`.
4. Aplikasi driver terpisah: `com.xavindo.tapgo.driver`; customer tetap `com.xavindo.tapgo`.
5. Backend tidak boleh memakai package name / installed app / header buatan client sebagai sumber kewenangan.
6. `ADMIN`/`SUPER_ADMIN` tidak punya bypass ke driver operational routes.
7. Suspend/reject driver mencabut capability seketika, **tanpa** mencabut passenger session.
8. Model `Driver` legacy deprecated; tidak dipakai untuk implementasi baru; **tidak dihapus** pada tahap ini.
9. Identifier sensitif memakai deterministic keyed **HMAC-SHA256** dengan secret terpisah dan versioned key.
10. Vehicle ownership mendukung active/retired/history/admin-reviewed transfer, satu active ownership per plate.
11. `UNDER_REVIEW` memakai `claimedBy`/`claimedAt`/`claimExpiresAt` + safe release + reassignment + audit.
12. Upload/penyimpanan dokumen nyata **BLOCKED** sampai tujuh keputusan storage disetujui.
13. Cache pada driver capability tidak diizinkan tanpa Architecture Decision baru.

---

## 5. Driver Onboarding State Machine

**PROPOSAL ONLY — NOT IMPLEMENTED.**

Enum yang ada **tidak** cukup: `RideDriverStatus` menggambarkan kapabilitas operasional, bukan siklus review. Diusulkan enum baru khusus aplikasi, dan `RideDriverStatus` **dipertahankan apa adanya**.

```
                    ┌──────────────── withdraw ────────────────┐
                    ▼                                          │
  (none) ──create──> DRAFT ──submit──> SUBMITTED ──claim──> UNDER_REVIEW
                       ▲                   │                   │
                       │                   │ withdraw          ├─ approve ─> APPROVED (terminal)
                       │                   ▼                   ├─ reject ──> REJECTED
                       └──── edit ──── WITHDRAWN (terminal)    └─ release/expire ─> SUBMITTED
                                                                      │
                            REJECTED ──resubmit(new application)──────┘
```

**Catatan penting:** `SUSPENDED` **tidak** dimasukkan ke state machine aplikasi. Suspensi adalah properti `RideDriverProfile`, bukan aplikasi — menaruhnya di dua tempat menciptakan dua sumber kebenaran. Setelah `APPROVED`, siklus hidup berpindah sepenuhnya ke `RideDriverProfile.status` yang sudah ada dan sudah teruji.
**OWNER DECISION REQUIRED (D-21):** apakah `WITHDRAWN` diperlukan, atau user cukup mengedit `DRAFT`?

### 5.1 Matriks transisi

| # | Transisi | Actor | Precondition (DB-authoritative) | Side effect diizinkan | Side effect dilarang | Audit event | Idempotency | Error code | Concurrency risk | Recovery |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | `(none)→DRAFT` | applicant (User ACTIVE) | Tidak ada aplikasi non-terminal milik user; tidak ada `RideDriverProfile` ACTIVE | Buat baris aplikasi | Membuat profil/kendaraan; mengubah role | `driver_application.created` | `Idempotency-Key`; partial unique index mengembalikan aplikasi yang ada | `DRIVER_APPLICATION_ALREADY_EXISTS` (409) | Dua request paralel | Kembalikan aplikasi eksisting, bukan error |
| T2 | `DRAFT→DRAFT` (edit) | applicant | Status `DRAFT`, pemilik cocok | Update field | Mengubah status | `driver_application.updated` | Natural (idempotent write) | `DRIVER_APPLICATION_NOT_EDITABLE` (409) | Lost update | Optimistic `version` |
| T3 | `DRAFT→SUBMITTED` | applicant | Status `DRAFT`; field wajib lengkap; dokumen wajib lengkap **(setelah Batch 5)** | Set `submittedAt` | Membuat profil | `driver_application.submitted` | Conditional update `WHERE status='DRAFT'` | `DRIVER_APPLICATION_INVALID_STATE` (409) | Double submit | Idempoten: sudah `SUBMITTED` → 200 |
| T4 | `SUBMITTED→UNDER_REVIEW` (claim) | reviewer scope | Status `SUBMITTED` **atau** lease kedaluwarsa | Set `claimedBy/At/ExpiresAt` | Keputusan apa pun | `driver_application.claimed` | Conditional update | `DRIVER_APPLICATION_CLAIM_CONFLICT` (409) | Dua admin claim | Lihat §6 |
| T5 | `UNDER_REVIEW→SUBMITTED` (release) | reviewer pemilik claim, atau sistem saat lease habis | Claim masih milik aktor, atau `claimExpiresAt < now()` | Kosongkan field claim | — | `driver_application.released` / `.claim_expired` | Conditional update | `DRIVER_APPLICATION_CLAIM_NOT_HELD` (409) | Release ganda | Aman: no-op |
| T6 | `UNDER_REVIEW→APPROVED` | reviewer pemilik claim aktif | Claim milik aktor **dan** belum kedaluwarsa | **Satu transaksi**: set `APPROVED` + **buat** `RideDriverProfile` (`status=ACTIVE`) + audit | Mengubah `User.role`; menyentuh wallet/komisi/membership | `driver_application.approved` + `ride_driver_profile.created` | Conditional update `WHERE status='UNDER_REVIEW' AND claimed_by=:actor` | `DRIVER_APPLICATION_DECISION_CONFLICT` (409) | Approve ganda; approve setelah claim pindah | Yang kalah dapat 409, tidak ada hasil campur |
| T7 | `UNDER_REVIEW→REJECTED` | reviewer pemilik claim aktif | Idem + `reason` wajib | Set `REJECTED` + `decisionReason` + audit | Membuat profil | `driver_application.rejected` | Idem T6 | Idem | Idem | Idem |
| T8 | `REJECTED→(aplikasi baru DRAFT)` | applicant | Tidak ada aplikasi non-terminal | Buat aplikasi **baru** (histori lama utuh) | Mengubah aplikasi lama | `driver_application.resubmitted` | Partial unique index | `DRIVER_APPLICATION_ALREADY_EXISTS` (409) | Resubmit ganda | Kembalikan yang ada |
| T9 | `DRAFT/SUBMITTED→WITHDRAWN` | applicant | Status non-terminal; belum `UNDER_REVIEW` | Set `WITHDRAWN` | — | `driver_application.withdrawn` | Conditional | `DRIVER_APPLICATION_INVALID_STATE` (409) | Withdraw saat admin claim | Tolak bila sudah `UNDER_REVIEW` |
| T10 | profil `ACTIVE→SUSPENDED/REJECTED` | admin | **Sudah ada** — `assertDriverModerationTransition` + guard ride aktif | Sudah ada | Sudah ada | Sudah ada | Sudah ada | `RIDE_DRIVER_STATUS_TRANSITION_INVALID` | Sudah ditangani | Sudah ada |
| T11 | profil `SUSPENDED→ACTIVE` (reactivate) | admin | **Sudah ada dan diizinkan** | Sudah ada | — | Sudah ada | Sudah ada | Idem | Sudah ditangani | Sudah ada |

**OWNER DECISION REQUIRED (D-19):** apakah reactivate dari `SUSPENDED` boleh dilakukan reviewer biasa atau wajib senior reviewer? Saat ini semua ADMIN setara.
**OWNER DECISION REQUIRED (D-20):** apakah `REJECTED` boleh resubmit tanpa batas, atau ada cooldown/maksimum percobaan?

### 5.2 Stale & duplicate request

- **Duplicate submit:** conditional update membuat percobaan kedua no-op dan mengembalikan state saat ini (200), bukan error.
- **Stale request:** setiap mutasi menyertakan `version` (optimistic). Mismatch → `DRIVER_APPLICATION_VERSION_CONFLICT` (409) dan klien wajib memuat ulang.

---

## 6. Review Claim / Lease Design

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 6.1 Field konseptual

`claimedBy`, `claimedAt`, `claimExpiresAt`, `releasedAt`, `releaseReason`, `reviewedBy`, `reviewedAt`, `decisionReason`, `version`.

### 6.2 Prinsip

Lease **berbasis waktu database** (`now()` dari PostgreSQL), bukan waktu klien atau waktu proses aplikasi. Ini menghilangkan clock skew antar instance backend maupun antar browser reviewer. Semua keputusan claim memakai **conditional update** yang mengevaluasi `claim_expires_at` terhadap `now()` di dalam transaksi yang sama.

### 6.3 Transaction pattern

**Claim (atomik, tanpa lock eksplisit):**

```sql
UPDATE ride_driver_applications
   SET status = 'UNDER_REVIEW',
       claimed_by = :actorId,
       claimed_at = now(),
       claim_expires_at = now() + :leaseInterval,
       released_at = NULL,
       release_reason = NULL,
       version = version + 1
 WHERE id = :applicationId
   AND (
         status = 'SUBMITTED'
      OR (status = 'UNDER_REVIEW' AND claim_expires_at < now())   -- lease kedaluwarsa
       )
RETURNING id, version, claim_expires_at;
```

`0 row` → `DRIVER_APPLICATION_CLAIM_CONFLICT` (409). Karena `UPDATE` mengambil row lock, dua admin yang berlomba diserialkan oleh PostgreSQL: satu menang, satu mendapat `0 row`. **Tidak perlu** `SELECT … FOR UPDATE` terpisah, dan tidak perlu Serializable isolation — pelajaran Stage 5.7 berlaku di sini (Serializable menambah 40001 false positive tanpa menambah jaminan).

**Keputusan (approve/reject) — hanya pemilik claim yang masih hidup:**

```sql
UPDATE ride_driver_applications
   SET status = :decision, reviewed_by = :actorId, reviewed_at = now(),
       decision_reason = :reason, claimed_by = NULL, claimed_at = NULL,
       claim_expires_at = NULL, version = version + 1
 WHERE id = :applicationId
   AND status = 'UNDER_REVIEW'
   AND claimed_by = :actorId
   AND claim_expires_at >= now()          -- admin lama yang lease-nya habis ditolak
   AND version = :expectedVersion
RETURNING id;
```

`0 row` → `DRIVER_APPLICATION_DECISION_CONFLICT` (409). **Approval penuh berjalan dalam satu transaksi**: conditional update di atas → `INSERT RideDriverProfile` → `INSERT AuditLog`. Bila salah satu gagal, semuanya rollback — pola identik dengan `updateDriverStatusByAdmin` yang sudah terbukti.

**Safe release:**

```sql
UPDATE ride_driver_applications
   SET status = 'SUBMITTED', claimed_by = NULL, claimed_at = NULL,
       claim_expires_at = NULL, released_at = now(), release_reason = :reason,
       version = version + 1
 WHERE id = :applicationId AND status = 'UNDER_REVIEW'
   AND (claimed_by = :actorId OR claim_expires_at < now());
```

### 6.4 Ancaman yang dicegah

| Ancaman | Pencegahan |
|---|---|
| Dua admin mereview aplikasi sama | Conditional update + row lock; hanya satu mendapat `RETURNING` |
| Claim permanen | `claim_expires_at`; setiap claim baru boleh mengambil alih lease kedaluwarsa **tanpa** job latar |
| Admin lama memutuskan setelah claim pindah | `claimed_by = :actorId AND claim_expires_at >= now()` |
| Approve/reject ganda | `status = 'UNDER_REVIEW'` + `version` |
| Lost update | Kolom `version` optimistic |
| Silent reassignment | `released_at`/`release_reason` + audit event `.claim_expired` / `.reassigned` |
| Reviewer crash/reconnect | Lease kedaluwarsa sendiri; reviewer yang kembali harus claim ulang |
| Duplicate tab | Idempoten: claim ulang oleh pemilik yang sama memperpanjang lease, bukan konflik |

**Lease expiry tidak memerlukan scheduler** — evaluasi terjadi lazily saat ada yang mencoba claim. Ini penting karena repo belum punya scheduler (G-11).
**OWNER DECISION REQUIRED (D-17):** durasi lease. Rekomendasi **15 menit**, dapat diperpanjang oleh pemilik claim.

---

## 7. Vehicle Ownership Lifecycle

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 7.1 Masalah dengan model sekarang

`RideVehicle` mencampur **identitas kendaraan** (plat, merek, tipe) dengan **kepemilikan** (`driverProfileId`). Akibatnya: plat tidak dapat berpindah driver tanpa menduplikasi kendaraan atau merusak `RideOrder.vehicleId` yang menunjuk kendaraan historis.

### 7.2 Entitas konseptual

| Entitas | Peran | Field utama |
|---|---|---|
| `RideVehicle` | **Identitas** kendaraan, tanpa pemilik | `id`, `type`, `plateBlindIndex` (HMAC), `plateKeyVersion`, `plateMasked`, `brand?`, `model?`, `color?`, `createdAt` |
| `RideVehicleOwnership` | **Kepemilikan temporal** | `id`, `vehicleId`, `driverProfileId`, `status` (`ACTIVE`/`RETIRED`/`TRANSFERRED`/`SUSPENDED`), `verificationStatus`, `isActive`, `startedAt`, `endedAt?`, `endReason?` |
| `RideVehicleDocument` | Dokumen kendaraan (STNK dll.) | `id`, `ownershipId`, `type`, `storageKey`, `status`, `expiresAt?` — **BLOCKED sampai D-01..D-06** |
| `RideVehicleTransfer` | Workflow transfer ter-review | `id`, `vehicleId`, `fromOwnershipId`, `toDriverProfileId`, `status`, `requestedBy`, `reviewedBy?`, `reviewedAt?`, `reason?` |

### 7.3 Constraint kunci

```sql
-- Satu active ownership per kendaraan pada satu waktu.
CREATE UNIQUE INDEX ride_vehicle_ownerships_one_active_key
  ON ride_vehicle_ownerships (vehicle_id)
  WHERE status = 'ACTIVE';

-- Identitas plat unik global (blind index HMAC, bukan SHA-256 unsalted).
CREATE UNIQUE INDEX ride_vehicles_plate_blind_index_key
  ON ride_vehicles (plate_blind_index);
```

Pola partial unique index ini **sudah dipakai** di `0016_founder_chairman_unique_guard`, jadi bukan konstruksi baru bagi repo ini.

Kombinasi keduanya memenuhi Owner Decision 10 tanpa mengunci plat selamanya: plat unik sebagai **identitas**, sementara **kepemilikan** boleh berpindah — tepat satu yang aktif kapan pun.

### 7.4 Workflow transfer

1. Driver B (atau admin) membuat `RideVehicleTransfer` berstatus `PENDING`.
2. Admin mereview (memakai pola lease yang sama seperti §6).
3. **Satu transaksi** saat approve: `UPDATE` ownership lama → `status='TRANSFERRED'`, `endedAt=now()`, `endReason='TRANSFER'`; `INSERT` ownership baru `status='ACTIVE'`, `verificationStatus='PENDING'`, `isActive=false`; `INSERT AuditLog`.
4. Kendaraan baru **tidak langsung** dapat menerima order — harus melewati verifikasi kendaraan yang sudah ada (`assertVehicleModerationTransition`).

Partial unique index menjamin langkah 3 gagal (bukan menghasilkan dua pemilik aktif) bila ada transfer paralel.

### 7.5 Skenario lain

| Skenario | Penanganan |
|---|---|
| Kendaraan dipensiunkan | `status='RETIRED'`, `endedAt`, `isActive=false` |
| Dokumen kendaraan kedaluwarsa | `RideVehicleDocument.expiresAt` → job/pemeriksaan menurunkan `isActive`; `verificationStatus` tetap `VERIFIED` agar histori jujur |
| Kendaraan ditangguhkan | `ownership.status='SUSPENDED'` — **tidak** menyentuh `User.status` maupun `RideDriverProfile.status`, sehingga akun penumpang tidak terpengaruh (Owner Decision 7) |
| Ride history | `RideOrder.vehicleId` menunjuk `RideVehicle` (identitas), yang **tidak pernah** dipindahkan atau dihapus → histori tetap benar walau kepemilikan berubah |
| Perubahan nomor kendaraan | Kendaraan **baru** + ownership baru + `RideVehicleTransfer` beralasan `PLATE_CHANGE`; kendaraan lama `RETIRED` |

### 7.6 Dampak migrasi

`ride_vehicles` produksi **kosong** (nol jalur pembuatan), sehingga restrukturisasi ini **tidak** memerlukan backfill data. Migrasi tetap harus additive dan diverifikasi non-destruktif.
**OWNER DECISION REQUIRED (D-18):** apakah transfer wajib disetujui admin selalu, atau boleh otomatis bila kedua driver sudah terverifikasi?

---

## 8. Identifier HMAC Architecture

**PROPOSAL ONLY — NOT IMPLEMENTED.**

### 8.1 Empat mekanisme yang berbeda — jangan dicampur

| Mekanisme | Tujuan | Reversibel? | Dipakai untuk |
|---|---|---|---|
| **HMAC / blind index** | *Lookup* & deduplication | **Tidak** | Cari "apakah NIK ini sudah terdaftar" tanpa menyimpan NIK |
| **Encryption** | Pemulihan/tampilan sah | **Ya** (dengan key) | Hanya bila raw value benar-benar harus dibaca kembali |
| **Masking** | Antarmuka pengguna | Tidak | `A 1234 ***`, `3201••••••••1234` |
| **Redaction** | Log | Tidak | Menghapus field dari log sepenuhnya |

**HMAC bukan pengganti encryption.** Jika Owner memutuskan raw NIK harus dapat ditampilkan ke reviewer, blind index saja tidak cukup — perlu envelope encryption (D-04). Saat ini repo **tidak punya** kemampuan enkripsi aplikatif (`createCipheriv` nol).

### 8.2 Konstruksi blind index

```
canonical = normalize(rawValue)                    // lihat §8.3
material  = "tapgo.v" + keyVersion + ":" + domain + ":" + canonical
blindIndex = HMAC-SHA256(key = IDENTIFIER_INDEX_KEY_v{n}, message = material)  → hex
```

- **Domain separation:** `domain ∈ {nik, sim, stnk, plate}`. Mencegah nilai identik lintas jenis menghasilkan index sama, dan mencegah cross-domain correlation.
- **Key terpisah:** bukan `JWT_ACCESS_SECRET`, bukan secret provider payment.
- **Key version** disimpan berdampingan (`plateKeyVersion`) agar rotasi tidak memerlukan downtime.

### 8.3 Canonical normalization (sebelum HMAC)

| Jenis | Normalisasi |
|---|---|
| NIK | hapus non-digit; wajib 16 digit |
| SIM | hapus non-alfanumerik; uppercase |
| STNK | hapus non-alfanumerik; uppercase |
| Plat | hapus seluruh whitespace & tanda hubung; uppercase (`B 1234 ABC` → `B1234ABC`) |

Normalisasi **wajib** deterministik dan diuji, karena input yang sama dengan spasi berbeda harus menghasilkan blind index yang sama — kalau tidak, deduplication bocor.

### 8.4 Environment variable (usulan nama)

`IDENTIFIER_INDEX_KEY_CURRENT_VERSION`, `IDENTIFIER_INDEX_KEY_V1`, `IDENTIFIER_INDEX_KEY_V2`, …
Validasi mengikuti pola yang ada: `z.string().min(32)`. **Tidak boleh** ada nilai default di source, dan tidak boleh masuk source control.

### 8.5 Rotasi

1. Tambah `IDENTIFIER_INDEX_KEY_V2`; `CURRENT_VERSION=2`.
2. Nilai **baru** ditulis dengan v2.
3. **Lookup selama rotasi:** cari `blindIndex(v2)`; bila tidak ketemu **dan** ada baris dengan `keyVersion=1`, cari `blindIndex(v1)`. Karena raw value ada pada request (bukan di DB), kedua index dapat dihitung saat itu juga — **tidak perlu** menyimpan raw value untuk rotasi.
4. Backfill bertahap: hitung ulang index untuk baris v1 hanya saat raw value tersedia lagi (mis. saat dokumen diverifikasi ulang), atau terima dual-lookup permanen.
5. Uniqueness selama rotasi: unique index pada `(blindIndex)` tetap berlaku per nilai; deduplication lintas versi ditangani oleh dual-lookup di atas.

**Collision:** HMAC-SHA256 256-bit — probabilitas tabrakan dapat diabaikan. Tabrakan yang terdeteksi (unique violation dengan raw value berbeda) diperlakukan sebagai **security incident**, bukan error biasa.

### 8.6 Larangan

Tidak boleh: raw SHA-256, unsalted hash, hard-coded secret, secret di source control, mencetak raw **maupun** nilai HMAC ke log, menaruh identifier di `AuditLog.metadata`, mengembalikan blind index lewat API.

### 8.7 Strategi test tanpa identifier nyata

Memakai **nilai sintetis yang jelas palsu** (mis. NIK `0000000000000001`, plat `Z 0001 ZZ`) dan key test khusus dari environment test. Test membuktikan: determinisme, domain separation (nilai sama, domain berbeda → index berbeda), normalisasi (varian spasi → index sama), dan bahwa nilai mentah tidak pernah muncul di respons/log. **Dilarang** memakai data KYC nyata di test.

---

## 9. Document Storage Decision Matrix

**PROPOSAL ONLY — NOT IMPLEMENTED.** Tidak ada akun dibuat, bucket dibuat, atau network call ke provider mana pun.

| Kriteria | AWS S3 (ap-southeast-3 Jakarta) | Google Cloud Storage (asia-southeast2 Jakarta) | Cloudflare R2 | Supabase Storage |
|---|---|---|---|---|
| Region Indonesia | **Ya** (Jakarta) | **Ya** (Jakarta) | Tidak ada region ID; jurisdiction hint terbatas | Region terbatas, umumnya SG |
| Private by default | Ya | Ya | Ya | Ya (bucket private) |
| Server-side encryption | Ya (SSE-S3/KMS) | Ya (Google-managed/CMEK) | Ya (managed) | Ya (managed) |
| KMS / customer-managed key | **Ya (SSE-KMS)** | **Ya (CMEK)** | **Tidak** (belum CMK) | Tidak |
| Signed URL berumur pendek | Ya | Ya | Ya (S3-compatible) | Ya |
| Access logging | Ya (server access log + CloudTrail) | Ya (audit logs) | Terbatas | Terbatas |
| Lifecycle / retention rules | Ya | Ya | Ya (sederhana) | Terbatas |
| Object Lock / legal hold | **Ya** | Retention policy | Tidak | Tidak |
| Versioning / backup | Ya | Ya | Ya | Terbatas |
| Malware scanning terintegrasi | Tidak native (GuardDuty Malware Protection for S3 tersedia) | Tidak native | Tidak | Tidak |
| Biaya egress | Mahal | Mahal | **$0 egress** | Sedang |
| Prediktabilitas biaya | Sedang (banyak dimensi) | Sedang | **Tinggi** | Tinggi |
| Kompleksitas operasional | Tinggi (IAM) | Tinggi (IAM) | **Rendah** | Rendah |
| Vendor lock-in | Tinggi | Tinggi | **Rendah (S3-compatible)** | Sedang |
| Disaster recovery | Kuat | Kuat | Sedang | Sedang |
| Kompatibilitas backend saat ini | `@aws-sdk/client-s3` | SDK terpisah | **`@aws-sdk/client-s3` (S3-compatible)** | SDK/HTTP |
| Kesiapan produksi untuk KYC | **Tinggi** | **Tinggi** | Sedang–Tinggi (tanpa CMK & Object Lock) | Sedang |

### 9.1 Rekomendasi

**Rekomendasi utama: Cloudflare R2**, dengan syarat data residency Indonesia **tidak** diwajibkan.
Alasan: private by default, S3-compatible sehingga satu SDK melayani R2 maupun S3 (mengurangi lock-in dan memudahkan migrasi), egress nol yang membuat biaya reviewer mengunduh dokumen dapat diprediksi, dan kompleksitas operasional paling rendah untuk tim sekecil ini.

**Runner-up: AWS S3 region `ap-southeast-3` (Jakarta)**, dan ini menjadi **rekomendasi utama bila** data residency Indonesia diwajibkan atau bila Object Lock/legal hold serta customer-managed key (KMS) menjadi syarat kepatuhan. S3 unggul jelas pada KMS, Object Lock, dan audit logging — tiga hal yang paling relevan untuk KYC.

**Tidak direkomendasikan:** Cloudinary (sudah ada di `env.ts` tetapi public-by-default, dirancang untuk media publik), dan Supabase Storage (kontrol retensi/audit belum setara).

### 9.2 Risiko & prasyarat

| Item | Catatan |
|---|---|
| Risiko R2 | Tanpa CMK dan tanpa Object Lock → legal hold harus ditegakkan di lapisan aplikasi; audit logging lebih lemah |
| Risiko S3 | Kompleksitas IAM; biaya egress saat reviewer sering mengunduh |
| Prasyarat keduanya | Bucket privat, versioning aktif, lifecycle rule, kredensial least-privilege terpisah per environment |
| Dampak operasional | Perlu dependency baru (`@aws-sdk/client-s3`), rotasi kredensial, dan runbook incident |

**LEGAL REVIEW REQUIRED:** apakah dokumen KYC pengemudi wajib disimpan di wilayah Indonesia, dan regulasi mana yang mengikat (perlindungan data pribadi, ketentuan sektor transportasi, kewajiban penyelenggara sistem elektronik). Hal ini **tidak dapat dibuktikan dari repository** dan tidak boleh saya simpulkan sendiri.

---

## 10. Recommended Storage Architecture

**PROPOSAL ONLY — NOT IMPLEMENTED.**

- Bucket **privat**, tanpa akses publik, tanpa URL permanen.
- Satu bucket per environment (`dev` / `staging` / `production`) dengan kredensial berbeda; **tidak** berbagi bucket.
- **Object key tidak boleh mengandung** NIK, nama, nomor HP, email, plat, atau identifier mentah:
  `drivers/{applicationUuid}/{documentUuid}` — keduanya UUID acak, tidak dapat ditebak, tidak berkorelasi dengan identitas.
- Enkripsi at rest (SSE/KMS sesuai D-03), TLS in transit.
- Upload lewat **presigned PUT** berumur pendek; unduh lewat **presigned GET** berumur sangat pendek.
- Metadata objek diminimalkan: **tidak** menyimpan nama asli file, tidak menyimpan identitas.
- Bytes dokumen **tidak pernah** masuk database; database hanya menyimpan `storageKey`, `checksum`, `contentType`, `sizeBytes`, `status`.

---

## 11. Document Lifecycle

**PROPOSAL ONLY — NOT IMPLEMENTED. BLOCKED sampai D-01 s.d. D-06 disetujui.**

```
INIT ──backend authorize──> AWAITING_UPLOAD ──presigned PUT──> UPLOADED
  └─> verify (HEAD: exists, size, content-type, checksum) ──> SCANNING
        ├─ infected ──> QUARANTINED (terminal, objek dihapus)
        └─ clean ────> PENDING_REVIEW ──reviewer──> ACCEPTED | REJECTED
                                                       │
                                    EXPIRED <── expiresAt ──┘
                                    REPLACED <── unggah pengganti
                                    DELETED  <── retensi / permintaan hapus
```

| Tahap | Kontrol |
|---|---|
| Inisiasi | Hanya pemilik aplikasi; aplikasi harus `DRAFT`; kuota jumlah dokumen per jenis |
| Presigned PUT | TTL pendek, `Content-Type` dan `Content-Length` **dikunci** pada signature |
| Verifikasi | `HEAD` objek: ukuran ≤ batas, content-type sesuai allowlist, checksum cocok |
| MIME sniffing | Validasi **magic bytes**, bukan hanya header `Content-Type` (mencegah polyglot) |
| Scanning | Wajib sebelum reviewer dapat mengakses; hasil `clean`/`infected` tercatat |
| Akses reviewer | Presigned GET TTL sangat pendek, hanya bila aplikasi sedang di-claim reviewer tersebut, setiap akses tercatat |
| Replacement | Dokumen lama `REPLACED`, objek lama dijadwalkan hapus |
| Retensi & hapus | Sesuai D-11 s.d. D-14; penghapusan mencakup versi objek dan backup |

---

## 12. Threat Model

| # | Ancaman | Mitigasi | Residual risk |
|---|---|---|---|
| T-01 | **IDOR** — mengakses dokumen milik orang lain | Otorisasi per-objek dari DB (pemilik atau reviewer pemegang claim); key UUID acak; tidak pernah menerima key dari klien | Bug otorisasi di endpoint baru — ditekan oleh test wajib |
| T-02 | **Signed URL bocor** (chat/log/screenshot) | TTL sangat pendek; URL sekali pakai per akses; tidak pernah masuk log | URL masih valid selama TTL |
| T-03 | **Upload berbahaya** | Allowlist MIME, magic-byte check, batas ukuran, scanning wajib, quarantine | Malware zero-day lolos scanner |
| T-04 | **Polyglot file** | Magic-byte + normalisasi/re-encode gambar; tidak pernah menyajikan dokumen dari origin aplikasi | Format eksotis |
| T-05 | **Oversized upload** | `Content-Length` dikunci di presigned; batas bucket; verifikasi `HEAD` | Biaya storage sementara |
| T-06 | **Metadata leakage** (EXIF, GPS, nama file) | Strip metadata; nama asli tidak disimpan; key tidak mengandung PII | Metadata tertanam dalam gambar bila strip gagal |
| T-07 | **Insider misuse** | Akses hanya saat memegang claim aktif; setiap unduhan tercatat; separation of duties | Reviewer sah menyalahgunakan akses sah |
| T-08 | **Admin tidak berwenang** | Scope `document:read` terpisah dari role ADMIN (Task H) | Salah pemberian scope |
| T-09 | **Akses admin basi** | Lease kedaluwarsa; akses dokumen mengikuti claim | Jendela selama lease |
| T-10 | **Bucket salah konfigurasi** | Private-by-default, IaC, pemeriksaan startup yang gagal-tertutup bila bucket publik | Perubahan manual di konsol |
| T-11 | **Kredensial bocor** | Least privilege per environment, rotasi, tidak pernah di source control, redaction log | Kebocoran lewat environment host |
| T-12 | **Backup persistence** | Kebijakan retensi backup terdefinisi; penghapusan mencakup versi objek | Backup provider di luar kendali (D-14) |
| T-13 | **Penghapusan tidak tuntas** | Hapus objek + seluruh versi + baris DB; verifikasi pasca-hapus | Salinan di cache CDN — dicegah dengan tidak memakai CDN |
| T-14 | **Object overwrite** | Key unik per dokumen; presigned PUT sekali pakai; versioning | — |
| T-15 | **Replay presigned URL** | TTL pendek; verifikasi status dokumen sebelum menerima upload | Replay dalam TTL |
| T-16 | **Enumeration** | UUID v4 acak, bukan sekuensial; daftar hanya lewat API terotorisasi | — |
| T-17 | **Privilege escalation lewat onboarding** | Aplikasi tidak pernah mengubah role/profil; hanya approval admin yang membuat profil, dalam satu transaksi + audit | — |
| T-18 | **Profil driver palsu** | Approval wajib admin; profil lahir `ACTIVE` hanya lewat T6; kendaraan tetap butuh verifikasi terpisah | Kolusi admin (dikurangi audit + D-19) |
| T-19 | **Substitusi kendaraan** | Blind index plat unik global + partial unique index satu active ownership + transfer ter-review | — |
| T-20 | **Driver ter-suspend tetap beroperasi** | Sudah ditutup Stage 5.11 (capability dari DB, tanpa cache) | Tidak ada, selama D-13 dipatuhi |

---

## 13. Retention and Deletion Proposal

Seluruh angka di bawah adalah **usulan** dan bertanda **OWNER DECISION REQUIRED**.

| Kondisi | Usulan | Decision ID |
|---|---|---|
| Aplikasi belum selesai (`DRAFT`) | Hapus dokumen setelah 30 hari tanpa aktivitas | D-11 |
| Aplikasi `REJECTED` | Simpan 90 hari untuk sanggahan, lalu hapus dokumen; metadata keputusan disimpan lebih lama | D-11 |
| Aplikasi `APPROVED` / driver aktif | Simpan selama hubungan berjalan | D-12 |
| Driver `SUSPENDED` | Simpan selama investigasi | D-12 |
| Akun driver ditutup | Hapus dokumen dalam SLA D-13 setelah kewajiban legal selesai | D-13 |
| Dokumen diganti/kedaluwarsa | Hapus objek lama dalam 30 hari | D-13 |
| Permintaan hapus dari user | Proses dalam SLA D-13, kecuali ada legal hold | D-13, D-16 |
| Investigasi fraud/keamanan | Menangguhkan penghapusan, wajib tercatat | D-16 |
| Legal hold | Menimpa seluruh jadwal; hanya otoritas D-16 yang boleh menetapkan/mencabut | D-16 |
| Retensi backup | Selaras dengan retensi dokumen; jangan lebih lama tanpa alasan | D-14 |
| Retensi audit log | Lebih lama dari dokumen (audit tidak memuat isi dokumen) | D-15 |

**LEGAL REVIEW REQUIRED** untuk seluruh periode di atas.
**Catatan teknis:** repo belum punya scheduler (G-11), sehingga retensi otomatis membutuhkan komponen baru pada Batch 6/11.

---

## 14. Authorized Access Model

Prinsip wajib: **default deny**, least privilege, purpose limitation, separation of duties, seluruh akses ter-audit, tanpa akun bersama, tanpa signed URL permanen, akses kedaluwarsa otomatis.

| Peran konseptual | Metadata aplikasi | Isi dokumen | Keputusan approve/reject | Legal hold |
|---|---|---|---|---|
| Applicant | Miliknya sendiri | Miliknya sendiri | ❌ | ❌ |
| Reviewer | Baca (antrean) | **Hanya saat memegang claim aktif** | ✅ | ❌ |
| Senior reviewer | Baca | Saat claim aktif | ✅ + reassignment | ❌ |
| Security/compliance | Baca | Dengan alasan tercatat | ❌ | ✅ |
| Customer support | Terbatas, ter-mask | ❌ | ❌ | ❌ |
| ADMIN | Sesuai scope | **❌ tanpa scope `document:read`** | Sesuai scope | ❌ |
| SUPER_ADMIN | Sesuai scope | **❌ tanpa scope `document:read`** | Sesuai scope | Sesuai scope |
| Automated scanner | ❌ | Hanya objek yang belum di-scan | ❌ | ❌ |

**Penting:** sesuai instruksi, `ADMIN`/`SUPER_ADMIN` **tidak** otomatis mendapat akses dokumen hanya karena nama role. Akses isi dokumen memerlukan **scope eksplisit** + claim aktif + audit trail. Ini memperkenalkan konsep scope yang belum ada (G-12) dan menjadi bagian Batch 8.
**OWNER DECISION REQUIRED (D-18b):** daftar scope final dan siapa yang boleh memberikannya.

---

## 15. Legacy Driver Migration Plan

| Langkah | Tindakan | Catatan |
|---|---|---|
| 1 | Tandai `Driver`, `DriverDocument`, `DriverEarning`, `WithdrawalRequest`, `Ride` (legacy) sebagai **deprecated** lewat komentar `///` pada schema + entri dokumentasi | Perubahan komentar saja; **bukan** pada Stage 5.12 |
| 2 | Larang penggunaan baru (aturan review; opsional lint rule) | — |
| 3 | Inventaris referensi | **Sudah dilakukan: nol referensi di `src/` dan `tests/`** |
| 4 | Dual-read/dual-write | **Tidak diperlukan** — tidak ada penulis maupun pembaca |
| 5 | Mapping `Driver` → `RideDriverProfile` | `userId` → `userId`; `status` → lihat tabel di bawah; `licenseNumber` → **jangan** disalin sebagai plaintext, hitung ulang blind index bila raw tersedia |
| 6 | Mapping kendaraan | `vehicleType`+`vehiclePlate` → `RideVehicle` + `RideVehicleOwnership`; plat harus dinormalisasi lalu di-HMAC |
| 7 | Mapping status | `OFFLINE/AVAILABLE/ON_TRIP` → `ACTIVE` (+`availability`); `SUSPENDED` → `SUSPENDED`; `kycStatus=APPROVED` → syarat `ACTIVE`; `REJECTED` → `REJECTED` |
| 8 | Data-quality checks | Plat duplikat, SIM duplikat, user hilang, kycStatus tidak konsisten |
| 9 | Duplicate resolution | Bila dua `Driver` memetakan ke satu `userId` atau plat sama → **hentikan dan eskalasi**, jangan pilih otomatis |
| 10 | Rollback | Migrasi additive; rollback = berhenti memakai tabel baru. Tabel legacy tidak disentuh sehingga selalu dapat dikembalikan |
| 11 | Compatibility window | Tidak diperlukan (nol konsumen), tetapi tabel tetap dipertahankan |
| 12 | Penghapusan | **Stage terpisah**, hanya setelah bukti migrasi lengkap dan persetujuan Owner |

**Verifikasi produksi belum dapat dilakukan** — saya tidak memiliki dan tidak boleh memiliki akses production, sehingga jumlah baris `drivers` di production **UNKNOWN**. Rencana di atas mengasumsikan kemungkinan tabel tidak kosong dan karenanya tetap menyertakan langkah 8–9.

---

## 16. Proposed Schema — Conceptual Only

**PROPOSAL ONLY — NOT IMPLEMENTED.** Seluruh perubahan bersifat **additive**; nol `ALTER`/`DROP` pada tabel lama.

```
enum RideDriverApplicationStatus { DRAFT SUBMITTED UNDER_REVIEW APPROVED REJECTED WITHDRAWN }
enum RideVehicleOwnershipStatus  { ACTIVE RETIRED TRANSFERRED SUSPENDED }
enum RideVehicleTransferStatus   { PENDING APPROVED REJECTED CANCELLED }
enum RideDriverDocumentStatus    { AWAITING_UPLOAD UPLOADED SCANNING QUARANTINED PENDING_REVIEW ACCEPTED REJECTED EXPIRED REPLACED DELETED }

RideDriverApplication
  id, userId, status, version
  licenseBlindIndex, licenseKeyVersion, licenseMasked, licenseExpiresAt
  nikBlindIndex?, nikKeyVersion?
  submittedAt?, claimedBy?, claimedAt?, claimExpiresAt?
  releasedAt?, releaseReason?, reviewedBy?, reviewedAt?, decisionReason?
  createdAt, updatedAt
  partial unique (userId) WHERE status IN ('DRAFT','SUBMITTED','UNDER_REVIEW')
  unique (licenseBlindIndex)              -- OWNER DECISION D-22: global atau per-periode
  index (status, claimExpiresAt)

RideVehicle            id, type, plateBlindIndex, plateKeyVersion, plateMasked, brand?, model?, color?, createdAt
                       unique (plateBlindIndex)
RideVehicleOwnership   id, vehicleId, driverProfileId, status, verificationStatus, isActive,
                       startedAt, endedAt?, endReason?, createdAt, updatedAt
                       partial unique (vehicleId) WHERE status='ACTIVE'
                       index (driverProfileId, status)
RideVehicleTransfer    id, vehicleId, fromOwnershipId?, toDriverProfileId, status,
                       requestedBy, reviewedBy?, reviewedAt?, reason?, createdAt
RideDriverDocument     id, applicationId, type, status, storageKey, checksum,
                       contentType, sizeBytes, scanResult?, expiresAt?, createdAt, updatedAt
                       -- BLOCKED sampai D-01..D-06
```

`RideDriverProfile`, `RideVehicle` yang ada, `RideOrder`, dan seluruh model Business Engine **tidak diubah** — kecuali `RideOrder.vehicleId` yang tetap menunjuk identitas kendaraan (tidak perlu perubahan).

---

## 17. Proposed API Surface — Conceptual Only

**PROPOSAL ONLY — NOT IMPLEMENTED.**

| Method | Path | Auth | Rate limit |
|---|---|---|---|
| POST | `/api/v1/driver/applications` | `requireAuth` | limiter onboarding baru |
| GET | `/api/v1/driver/applications/me` | `requireAuth` | `apiRateLimiter` |
| PATCH | `/api/v1/driver/applications/me` | `requireAuth` + status `DRAFT` | onboarding |
| POST | `/api/v1/driver/applications/me/submit` | `requireAuth` | onboarding |
| POST | `/api/v1/driver/applications/me/withdraw` | `requireAuth` | onboarding |
| POST | `/api/v1/driver/applications/me/documents` | `requireAuth` | **BLOCKED** |
| GET | `/api/v1/admin/driver-applications` | scope `application:read` | `adminRateLimiter` |
| POST | `/api/v1/admin/driver-applications/:id/claim` | scope `application:review` | `adminRateLimiter` |
| POST | `/api/v1/admin/driver-applications/:id/release` | scope `application:review` | `adminRateLimiter` |
| POST | `/api/v1/admin/driver-applications/:id/decision` | scope `application:review` | `adminRateLimiter` |
| GET | `/api/v1/admin/driver-applications/:id/documents/:docId/url` | scope `document:read` + claim aktif | ketat | **BLOCKED** |
| POST | `/api/v1/admin/vehicle-transfers/:id/decision` | scope `vehicle:review` | `adminRateLimiter` |

Route operasional driver yang sudah ada **tidak berubah** dan tetap memakai `requireDriverCapability` (Stage 5.11).

---

## 18. Error Code Catalogue

Mengikuti konvensi modul (prefiks `RIDE_`/`DRIVER_`), stabil, tidak membocorkan detail internal.

| Code | HTTP | Makna |
|---|---|---|
| `DRIVER_APPLICATION_ALREADY_EXISTS` | 409 | Sudah ada aplikasi non-terminal |
| `DRIVER_APPLICATION_NOT_FOUND` | 404 | Tidak ada / bukan milik pemanggil |
| `DRIVER_APPLICATION_NOT_EDITABLE` | 409 | Bukan `DRAFT` |
| `DRIVER_APPLICATION_INVALID_STATE` | 409 | Transisi tidak sah |
| `DRIVER_APPLICATION_INCOMPLETE` | 400 | Field/dokumen wajib belum lengkap |
| `DRIVER_APPLICATION_VERSION_CONFLICT` | 409 | Optimistic lock gagal |
| `DRIVER_APPLICATION_CLAIM_CONFLICT` | 409 | Sudah di-claim reviewer lain yang masih aktif |
| `DRIVER_APPLICATION_CLAIM_NOT_HELD` | 409 | Aktor bukan pemegang claim / lease habis |
| `DRIVER_APPLICATION_DECISION_CONFLICT` | 409 | Keputusan ganda / kalah balapan |
| `DRIVER_PROFILE_ALREADY_EXISTS` | 409 | Sudah punya `RideDriverProfile` |
| `RIDE_VEHICLE_PLATE_TAKEN` | 409 | Plat sudah punya active ownership |
| `RIDE_VEHICLE_TRANSFER_CONFLICT` | 409 | Transfer paralel |
| `RIDE_VEHICLE_OWNERSHIP_NOT_ACTIVE` | 409 | Ownership tidak aktif |
| `DRIVER_DOCUMENT_TYPE_INVALID` | 400 | Jenis dokumen tidak dikenal |
| `DRIVER_DOCUMENT_TOO_LARGE` | 413 | Melebihi batas |
| `DRIVER_DOCUMENT_UNSUPPORTED_TYPE` | 415 | MIME di luar allowlist |
| `DRIVER_DOCUMENT_NOT_READY` | 409 | Belum lulus scanning |
| `DRIVER_DOCUMENT_ACCESS_DENIED` | 403 | Tanpa scope/claim aktif |
| `IDENTIFIER_ALREADY_REGISTERED` | 409 | Blind index bentrok |

Kode Stage 5.11 (`RIDE_DRIVER_PROFILE_REQUIRED`, `RIDE_DRIVER_NOT_ACTIVE`, `RIDE_DRIVER_ACCOUNT_INACTIVE`) **tidak berubah**.

---

## 19. Audit Event Catalogue

Memakai `AuditLog` yang ada. `metadata` **dilarang** memuat raw identifier, isi dokumen, signed URL, atau nilai blind index.

| `action` | `entityType` | Metadata yang diizinkan |
|---|---|---|
| `driver_application.created` / `.updated` / `.submitted` / `.withdrawn` | `RideDriverApplication` | status lama→baru |
| `driver_application.claimed` / `.released` / `.claim_expired` / `.reassigned` | `RideDriverApplication` | `claimedBy`, `claimExpiresAt` |
| `driver_application.approved` / `.rejected` | `RideDriverApplication` | keputusan, `reasonCode` (bukan teks bebas berisi PII) |
| `ride_driver_profile.created` | `RideDriverProfile` | `applicationId` |
| `ride_vehicle.registered` | `RideVehicle` | `plateMasked` saja |
| `ride_vehicle_ownership.started` / `.retired` / `.transferred` / `.suspended` | `RideVehicleOwnership` | status lama→baru |
| `ride_vehicle_transfer.requested` / `.approved` / `.rejected` | `RideVehicleTransfer` | pihak (id), `reasonCode` |
| `driver_document.uploaded` / `.scanned` / `.accepted` / `.rejected` / `.replaced` / `.deleted` | `RideDriverDocument` | jenis, status, hasil scan — **tanpa** key/URL |
| `driver_document.viewed` | `RideDriverDocument` | aktor, waktu, `applicationId` |
| `identifier.collision_detected` | `RideDriverApplication` | jenis identifier saja |

---

## 20. Stage 5.13 Implementation Batches

**Jangan memulai batch mana pun.**

| # | Batch | Scope | Dependency | Modul terdampak | Migration | Test | Rollback | Security gate | Owner prerequisite | Tetap BLOCKED |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Schema foundation | Enum + `RideDriverApplication` | — | `prisma/`, `modules/rides` | Additive | Non-destructive scan | Berhenti pakai tabel | Nol destructive | D-21, D-22 | Dokumen |
| 2 | Review claim/lease | Claim/release/decision + audit | 1 | `modules/rides` | — | Konkurensi 2 admin, lease expiry | Revert | Nol double-approve | D-17, D-19 | — |
| 3 | Vehicle ownership | `RideVehicle*` + partial unique | 1 | `modules/rides`, `prisma/` | Additive | Transfer race, satu active | Revert | Nol dua pemilik aktif | D-18 | — |
| 4 | Identifier HMAC service | Normalisasi + blind index + versioning | — | `core/security` baru | — | Determinisme, domain separation, rotasi | Revert | Nol raw/HMAC di log | D-05, D-06 | — |
| 5 | Document **metadata only** | Status dokumen tanpa bytes | 1 | `modules/rides` | Additive | State machine | Revert | Nol bytes di DB | D-07, D-08, D-09 | Upload nyata |
| 6 | Private storage integration | SDK, presigned, verifikasi | 5 | infra + `modules/rides` | — | Integration dengan mock | Feature flag | Bucket privat fail-closed | **D-01..D-04** | Sampai D-01..D-04 |
| 7 | Malware scanning | Scan + quarantine | 6 | infra | — | File uji EICAR | Feature flag | Nol akses sebelum clean | D-10 | Sampai D-10 |
| 8 | Admin review API | Scope + endpoint + akses dokumen | 2,5,7 | `modules/rides`, `core/security` | — | RBAC/scope matrix | Revert | Nol akses tanpa scope | D-18b | Akses dokumen |
| 9 | Driver mobile onboarding | UI aplikasi `com.xavindo.tapgo.driver` | 1–8 | `apps/driver_app` | — | Widget + live visual gate | Revert | Nol secret di klien | Rename package | Upload UI |
| 10 | Migration/backfill legacy | Deprecate + mapping | 1,3,4 | `prisma/`, script | Komentar saja | Data-quality | Tidak ada penghapusan | Nol plaintext baru | D-23 | Penghapusan |
| 11 | Security verification | Pentest internal, review log/retensi | 1–10 | seluruh | — | Threat model regression | — | Seluruh T-01..T-20 | D-11..D-16 | — |
| 12 | Production rollout | Feature flag bertahap | 11 | infra | Deploy | Smoke | Matikan flag | Runbook incident | Semua | — |

---

## 21. Risks and Dependencies

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Tidak ada scheduler (G-11) | Retensi/deletion tidak otomatis | Lease dibuat lazy; retensi menunggu komponen baru |
| Tidak ada kemampuan enkripsi (G-10) | Raw identifier tidak dapat disimpan aman bila dibutuhkan | Hindari menyimpan raw; bila wajib, tambahkan envelope encryption (D-04) |
| Tidak ada scope RBAC (G-12) | Akses dokumen tidak dapat dibatasi dengan benar | Batch 8 sebelum akses dokumen dibuka |
| `CLOUDINARY_*` menyesatkan (G-9) | Risiko dipakai keliru untuk KYC | Dokumentasikan larangan; bersihkan pada stage terpisah |
| Ketergantungan legal belum jelas | Region/retensi tidak dapat difinalkan | LEGAL REVIEW REQUIRED |
| Beban query capability (Stage 5.11) | Satu join per operasi driver | Diterima Owner Decision 3; cache dilarang (Decision 13) |
| Isi `drivers` production UNKNOWN | Migrasi bisa lebih rumit | Langkah data-quality & duplicate resolution wajib |

---

## 22. Legal Review Required

| # | Item | Mengapa tidak dapat saya putuskan |
|---|---|---|
| L-1 | Kewajiban data residency dokumen KYC di Indonesia | Tidak dapat dibuktikan dari repository; menentukan pilihan provider/region |
| L-2 | Dokumen wajib untuk pengemudi (SIM, STNK, KTP/NIK, SKCK, selfie/liveness) | Persyaratan regulasi, bukan keputusan teknis |
| L-3 | Periode retensi minimum & maksimum per kategori | Bergantung regulasi perlindungan data & sektor transportasi |
| L-4 | Dasar hukum & pemberitahuan pemrosesan data pribadi | Perlu peninjauan kebijakan privasi (`docs/PRIVACY_POLICY.md` belum mencakup dokumen driver) |
| L-5 | Otoritas dan prosedur legal hold | Perlu kebijakan internal resmi |
| L-6 | Kewajiban notifikasi insiden kebocoran | Menentukan runbook |

Saya sengaja tidak membuat klaim legal definitif apa pun di dokumen ini.

---

## 23. Owner Decisions Required

Ringkasan naratif; register lengkap ada di §26.

Blocking Batch 6 ke atas: **D-01** (provider), **D-02** (region), **D-03** (KMS), **D-04** (enkripsi raw identifier).
Blocking Batch 1–4: **D-05**, **D-06** (kunci HMAC), **D-17** (durasi lease), **D-18** (aturan transfer), **D-19** (reactivate), **D-21**, **D-22**.
Blocking Batch 11: **D-11** s.d. **D-16** (retensi, deletion SLA, backup, legal hold).

---

## 24. Go/No-Go Recommendation

**GO — Batch 1, 2, 3, 4** setelah Owner menjawab D-05, D-06, D-17, D-18, D-19, D-21, D-22. Keempat batch ini tidak menyentuh dokumen sama sekali, seluruhnya additive, dan menutup gap paling berbahaya (G-1 s.d. G-6) termasuk mengganti SHA-256 unsalted pada plat.

**NO-GO — Batch 5 ke atas** sampai D-01 s.d. D-04 dan D-07 s.d. D-10 dijawab, serta L-1 dan L-2 selesai ditinjau.

**Alasan pemisahan:** onboarding tanpa dokumen tetap bernilai (aplikasi, review ter-lease, kepemilikan kendaraan, identifier aman) dan dapat diuji penuh, sementara dokumen adalah bagian dengan risiko hukum dan keamanan tertinggi yang tidak boleh dimulai atas asumsi.

---

## 25. Files Inspected

Read-only, tanpa membaca nilai secret:

```
apps/backend/prisma/schema.prisma
apps/backend/prisma/migrations/20260729120000_ride_domain_foundation/migration.sql
apps/backend/prisma/migrations/0016_founder_chairman_unique_guard/migration.sql
apps/backend/prisma/migrations/0011_withdrawal_real_system/migration.sql
apps/backend/src/config/env.ts                      (nama variabel saja)
apps/backend/src/core/logger/logger.ts
apps/backend/src/core/security/authContext.ts
apps/backend/src/core/security/rateLimit.ts
apps/backend/src/lib/doku/signature.ts
apps/backend/src/modules/auth/application/AuthService.ts
apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts
apps/backend/src/modules/rides/application/RideService.ts
apps/backend/src/modules/rides/presentation/ride.routes.ts
apps/backend/src/modules/rides/presentation/driverCapability.ts
apps/backend/src/modules/rides/infrastructure/PrismaMatchingAdapter.ts
apps/backend/src/modules/rides/domain/rideStateMachine.ts
apps/backend/src/modules/admin-console/application/AdminConsoleService.ts
apps/backend/src/modules/account/presentation/
apps/backend/package.json
apps/backend/tests/rides/
docs/ (daftar isi)
```

---

## 26. Owner Decision Register

| ID | Question | Recommended | Alternatives | Security impact | Cost/ops impact | Blocking stage | Status |
|---|---|---|---|---|---|---|---|
| D-01 | Private object-storage provider? | **Cloudflare R2** (bila residency ID tidak wajib) | AWS S3 Jakarta; GCS Jakarta; Supabase | S3 unggul KMS/Object Lock/audit | R2 egress $0, ops lebih rendah | Batch 6 | PENDING |
| D-02 | Storage region? | `ap-southeast-3` (Jakarta) bila S3 | R2 global; SG | Residency & yurisdiksi | Latensi | Batch 6 | PENDING |
| D-03 | KMS / customer-managed key? | **Ya**, bila memilih S3/GCS | SSE managed | CMK memperkuat pemisahan kunci | Biaya KMS + ops rotasi | Batch 6 | PENDING |
| D-04 | Raw identifier perlu dapat dibaca kembali? | **Tidak** — blind index + masking saja | Envelope encryption | Menyimpan raw menambah risiko besar | Perlu utilitas enkripsi baru | Batch 4/6 | PENDING |
| D-05 | HMAC key custody? | Secret manager terpisah dari secret payment | Env host; KMS | Kompromi satu kunci tidak meruntuhkan lain | Ops rotasi | Batch 4 | PENDING |
| D-06 | Periode rotasi kunci HMAC? | 12 bulan + rotasi darurat | 6 bulan; tanpa rotasi | Membatasi dampak kebocoran | Dual-lookup selama rotasi | Batch 4 | PENDING |
| D-07 | Dokumen wajib per tahap onboarding? | SIM + STNK saat submit; sisanya menyusul | Semua di depan | Lebih sedikit data = lebih aman | UX | Batch 5 | PENDING |
| D-08 | Selfie/liveness wajib? | Ya untuk anti-impersonation | Tidak | Menurunkan driver palsu | Biaya vendor | Batch 5 | PENDING |
| D-09 | Ukuran file maksimum & MIME allowlist? | 8 MB; `image/jpeg`, `image/png`, `application/pdf` | 5/10 MB; + HEIC | Membatasi malicious upload | Storage | Batch 5 | PENDING |
| D-10 | Malware scanner? | ClamAV terkelola atau GuardDuty Malware Protection | Vendor pihak ketiga | Wajib sebelum akses reviewer | Biaya + latensi | Batch 7 | PENDING |
| D-11 | Retensi aplikasi rejected? | 90 hari | 30/180 hari | Data minimization | Storage | Batch 11 | PENDING |
| D-12 | Retensi driver approved? | Selama hubungan + periode legal | Tetap | Kepatuhan | Storage | Batch 11 | PENDING |
| D-13 | Deletion SLA? | 30 hari sejak pemicu | 7/90 hari | Kepercayaan pengguna | Ops | Batch 11 | PENDING |
| D-14 | Retensi backup? | Selaras retensi dokumen, maks 35 hari | Lebih lama | Backup menahan data terhapus | Biaya | Batch 11 | PENDING |
| D-15 | Retensi audit log? | 24 bulan | 12 bulan | Investigasi | Storage | Batch 11 | PENDING |
| D-16 | Otoritas legal hold? | Security/compliance, dua orang | Super admin tunggal | Mencegah penyalahgunaan | Proses | Batch 11 | PENDING |
| D-17 | Durasi reviewer claim? | **15 menit**, dapat diperpanjang | 5/30/60 menit | Terlalu lama = antrean macet | UX reviewer | Batch 2 | PENDING |
| D-18 | Aturan approval transfer kendaraan? | Selalu review admin | Otomatis bila kedua driver aktif | Mencegah substitusi | Beban admin | Batch 3 | PENDING |
| D-18b | Daftar scope reviewer & pemberinya? | `application:read/review`, `document:read`, `vehicle:review`, `legal:hold` | Role tunggal | Least privilege | Ops IAM | Batch 8 | PENDING |
| D-19 | Kebijakan reaktivasi driver? | Senior reviewer + alasan wajib | Reviewer biasa | Mencegah pemulihan diam-diam | Proses | Batch 2 | PENDING |
| D-20 | Cooldown resubmit setelah rejected? | 7 hari, maks 3 kali | Tanpa batas | Mengurangi spam | UX | Batch 1 | PENDING |
| D-21 | Perlukah status `WITHDRAWN`? | Ya | Cukup hapus `DRAFT` | Jejak audit lebih jujur | — | Batch 1 | PENDING |
| D-22 | `licenseBlindIndex` unik global? | Ya | Per-periode | Mencegah satu SIM banyak akun | Perlu resolusi duplikat | Batch 1 | PENDING |
| D-23 | Kapan menghapus model legacy? | Stage terpisah setelah bukti migrasi | Sekarang | Penghapusan dini berisiko | — | Batch 10 | PENDING |

---

*Akhir dokumen. Stage 5.12 belum disetujui.*
