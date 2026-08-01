# Stage 5.12 — Driver Onboarding Architecture & Document Security Decision

> **PROPOSAL ONLY — NOT IMPLEMENTED.**
> Seluruh schema, API, enum, error code, dan kebijakan dalam dokumen ini adalah usulan.
> Tidak ada source code, Prisma schema, migration, test, atau infrastruktur yang diubah pada Stage 5.12.

| | |
|---|---|
| Branch | `agent/tapgo-release2-driver` |
| Baseline implementasi | `ea5b5a5d2740342460604bd9d32960398cd5bca5` |
| Commit arsitektur | `e0f533633c1e8c959dfd704d26ab9d10f0ed2be8` |
| Stage | 5.12 — design & decision package |
| Status | **CONDITIONAL APPROVAL** — Owner Decision tercatat 2026-08-01 |

### Riwayat revisi

| Tanggal | Perubahan |
|---|---|
| 2026-08-01 | Dokumen awal (`e0f5336`) — seluruh 24 keputusan berstatus PENDING |
| **2026-08-01** | **Owner Decision tercatat.** D-01, D-02, D-03, D-05, D-06, D-17, D-18, D-18b, D-19, D-21, D-22 → **APPROVED**. Rekomendasi storage diubah ke AWS S3 `ap-southeast-3` + SSE-KMS customer-managed key. Desain rotasi HMAC dikoreksi (lihat §8.5). Batch 1–4 dinyatakan **GO FOR IMPLEMENTATION PLANNING**. |

---

## 1. Executive Summary

Stage 5.11 sudah menutup lubang otorisasi driver: kewenangan kini berasal dari database (`User.status` + `RideDriverProfile.status`), bukan dari klaim role pada JWT. Yang belum ada adalah **cara sah untuk menjadi driver**. Audit membuktikan **nol** jalur produksi yang membuat `RideDriverProfile` maupun `RideVehicle` — kedua tabel hanya pernah diisi oleh test.

Dokumen ini mengusulkan arsitektur onboarding end-to-end yang aman, dengan lima keputusan arsitektur utama:

1. **Onboarding sebagai entitas terpisah** (`RideDriverApplication`), bukan memperluas `RideDriverProfile`. Profil hanya lahir saat approval, sehingga tidak ada state setengah jadi yang bisa disalahartikan sebagai kapabilitas.
2. **Review claim berbasis lease** dengan `claimExpiresAt`, conditional update, dan reassignment aman — mencegah dua admin mereview aplikasi yang sama sekaligus mencegah aplikasi terkunci permanen.
3. **Vehicle ownership temporal** (`RideVehicleOwnership`) dengan partial unique index untuk "satu active ownership per plate", sehingga plat dapat berpindah secara sah tanpa kehilangan histori dan tanpa merusak `RideOrder` lama.
4. **Blind index HMAC-SHA256 berkunci** dengan domain separation dan key versioning untuk NIK/SIM/STNK/plat — memisahkan tegas antara *lookup*, *encryption*, *masking*, dan *redaction*.
5. **Private object storage** untuk dokumen. **Keputusan Owner 2026-08-01: AWS S3 private bucket, region `ap-southeast-3` (Jakarta), SSE-KMS dengan customer-managed key khusus KYC.** Cloudflare R2 **tidak** dipilih untuk dokumen KYC produksi.

**Temuan paling penting:** `CLOUDINARY_*` sudah dideklarasikan di `env.ts` tetapi **tidak dipakai kode mana pun**. Cloudinary adalah media CDN yang public-by-default dan **tidak layak** untuk dokumen KYC. Deklarasi ini harus tidak dipakai untuk onboarding dan sebaiknya dibersihkan pada stage terpisah.

**Status Go/No-Go setelah Owner Decision 2026-08-01:**

- **Batch 1–4 — GO FOR IMPLEMENTATION PLANNING.** Seluruh prasyarat keputusan untuk schema foundation, review lease, vehicle ownership, dan identifier HMAC service sudah APPROVED (D-05, D-06, D-17, D-18, D-19, D-21, D-22). Keempatnya tidak menyentuh dokumen sama sekali. Catatan: D-20 (cooldown resubmit) masih PENDING tetapi tidak memblokir — bila belum diputuskan saat implementasi, resubmit dibiarkan tanpa cooldown dan ditambahkan kemudian sebagai aturan terpisah.
- **Batch 5 ke atas — NO-GO.** Meskipun D-01 s.d. D-03 sudah APPROVED, **document upload tetap BLOCKED** sampai D-04, D-07, D-08, D-09, D-10, D-11 s.d. D-16, serta L-1 dan L-2 selesai.

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

**Ditambahkan 2026-08-01** (lihat register §26.1 untuk rationale dan consequences lengkap):

14. Storage dokumen KYC produksi: **AWS S3 private bucket, region `ap-southeast-3` (Jakarta), SSE-KMS dengan customer-managed key khusus KYC.** Cloudflare R2 tidak dipilih.
15. HMAC key khusus backend di production secret manager, terpisah dari JWT/payment/storage/KMS/database, mendukung versioning.
16. Rotasi HMAC 12 bulan + rotasi segera saat insiden; maksimal dua versi aktif; **tidak ada silent fallback tanpa audit**; kunci lama tidak dihapus sebelum bukti migrasi lengkap.
17. Reviewer lease default **15 menit** dengan renewal atomik; keputusan hanya sah bila claim masih dimiliki dan belum expired.
18. Vehicle transfer wajib admin review dengan explicit scope, transaksi atomik, dan audit lengkap.
19. Otorisasi reviewer memakai **explicit scopes**, bukan role. `ADMIN`/`SUPER_ADMIN` tidak otomatis memperoleh akses isi dokumen KYC.
20. Reaktivasi driver hanya melalui manual review ber-scope, **tanpa mengubah `User.role`**.
21. `WITHDRAWN` adalah status terminal; resubmission membuat cycle baru; histori dipertahankan.
22. Satu nomor SIM hanya untuk satu identitas driver; konflik **tidak diselesaikan otomatis**; SIM tidak dapat ditransfer.

**Catatan penting:** persetujuan butir 14 **tidak** membatalkan butir 12. Upload dokumen tetap BLOCKED.

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

### 8.5 Rotasi — DIKOREKSI 2026-08-01 (D-06 APPROVED)

> **Prinsip yang mengikat, jangan sampai salah paham:**
> **Blind index lama TIDAK dapat dikonversi menjadi blind index baru.**
> HMAC adalah fungsi satu arah. Tanpa **canonical raw identifier**, mustahil menghitung `HMAC(key_v2, …)` dari `HMAC(key_v1, …)`. Tidak ada "re-key" di sisi database, tidak ada backfill massal, dan tidak ada migrasi otomatis. Setiap desain yang mengasumsikan sebaliknya salah secara kriptografis.

Revisi ini menggantikan rumusan sebelumnya yang dapat memberi kesan backfill dapat dilakukan tanpa nilai mentah.

**Kebijakan yang disetujui (D-06):** rotasi terjadwal setiap **12 bulan**; rotasi segera saat insiden atau dugaan kompromi; kunci ber-versi; **maksimal dua versi aktif** selama transition window; setiap blind index menyimpan `keyVersion`; **tidak ada silent fallback tanpa audit**; kunci lama **tidak boleh dihapus** sebelum seluruh record terkait dimigrasikan, diverifikasi ulang, atau dinyatakan tidak dapat digunakan.

#### 8.5.1 Prosedur rotasi

1. Tambahkan `IDENTIFIER_INDEX_KEY_V2` melalui secret manager. Tandai v2 sebagai **write key**; v1 tetap sebagai **lookup-only key**.
2. Seluruh nilai **baru** ditulis dengan v2 dan menyimpan `keyVersion = 2`.
3. **Dual lookup hanya sah ketika identifier diberikan kembali oleh alur yang sah.** Backend menerima canonical raw identifier dari request, lalu menghitung index untuk **kedua** versi aktif dan mencari keduanya. Nilai mentah **tidak** diambil dari database — database tidak pernah menyimpannya (kecuali D-04 kelak menyetujui encryption).
4. **Migrasi bersifat lazy dan oportunistik.** Sebuah record hanya dapat berpindah ke v2 ketika identifier-nya tersedia lagi secara sah, yaitu pada salah satu peristiwa berikut:
   - user melakukan **verified resubmission**;
   - dokumen **diverifikasi ulang** oleh reviewer berwenang;
   - **authorized workflow** memperoleh identifier secara sah (mis. koreksi data ter-audit).
5. Setelah identifier diterima **dan** diverifikasi, dalam satu transaksi:
   - hitung index dengan **kunci lama** untuk menemukan record lama;
   - hitung index dengan **kunci baru**;
   - simpan index baru beserta `keyVersion` baru;
   - **jangan** menyimpan raw identifier kecuali D-04 kelak menyetujuinya;
   - **jangan** mencatat raw identifier maupun nilai blind index ke log.
6. **Record yang belum dapat dimigrasikan** (identifier tidak pernah muncul lagi) ditangani dengan: mempertahankan kunci lama secara **terbatas dan tercatat**, menandai `indexMigrationState`, meminta re-verification melalui workflow yang sah, dan **tidak** menghapus kunci lama secara prematur.
7. **Retirement kunci lama** hanya dilakukan setelah **migration evidence lengkap**: seluruh record sudah bermigrasi, atau secara eksplisit dinyatakan tidak dapat digunakan (mis. aplikasi terminal yang sudah melewati masa retensi) dengan persetujuan tercatat.

#### 8.5.2 State migrasi per record

`indexMigrationState ∈ { CURRENT, LEGACY_PENDING_REVERIFICATION, LEGACY_UNRECOVERABLE }`

- `CURRENT` — index memakai write key aktif.
- `LEGACY_PENDING_REVERIFICATION` — masih memakai kunci lama; menunggu peristiwa sah pada §8.5.1 butir 4.
- `LEGACY_UNRECOVERABLE` — identifier tidak akan muncul kembali (mis. aplikasi `REJECTED` yang sudah melewati retensi). Record ini **tidak** boleh menjadi alasan menahan kunci lama selamanya; ia dinyatakan tidak dapat digunakan untuk deduplication dan dicatat.

#### 8.5.3 Risiko rotasi, mitigasi, dan acceptance criteria

| # | Risiko | Dampak | Mitigasi | Acceptance criteria |
|---|---|---|---|---|
| R-1 | **Indefinite legacy-key retention** — kunci lama tertahan selamanya karena selalu ada sisa record | Permukaan serangan kunci tidak pernah mengecil; melanggar semangat rotasi | Batas waktu transition window yang tercatat; record yang melewati batas dinyatakan `LEGACY_UNRECOVERABLE` lewat keputusan ter-audit, bukan dibiarkan menggantung | Ada laporan berkala jumlah record per `indexMigrationState`; tidak ada kunci lama yang aktif melewati window tanpa keputusan tertulis |
| R-2 | **Unverifiable legacy record** — record lama tidak dapat diverifikasi karena identifier tidak tersedia | Deduplication untuk record itu tidak dapat dijamin | Tandai `LEGACY_UNRECOVERABLE`; wajib re-verification bila identitas tersebut dipakai lagi | Setiap record `LEGACY_UNRECOVERABLE` memiliki alasan dan aktor yang tercatat |
| R-3 | **Lost deduplication coverage** — selama window, pencarian hanya memakai satu versi sehingga duplikat lolos | Satu SIM/NIK bisa terdaftar dua kali | **Dual lookup wajib** selama window; sistem menolak menulis bila salah satu kunci aktif tidak tersedia (fail-closed, bukan diam-diam melewati) | Test membuktikan: identifier yang tersimpan dengan v1 tetap terdeteksi saat diajukan ulang setelah `CURRENT_VERSION=2` |
| R-4 | **Duplicate identity during incomplete rotation** | Dua identitas driver untuk satu SIM (melanggar D-22) | Unique constraint tetap berlaku per index; konflik lintas versi **tidak diselesaikan otomatis** → eskalasi admin review (D-22) | Test membuktikan konflik lintas versi memunculkan `IDENTIFIER_ALREADY_REGISTERED` dan audit, bukan pembuatan diam-diam |
| R-5 | **Accidental secret retirement** — kunci lama dihapus sebelum migrasi selesai | Record lama menjadi permanen tak dapat dicari; deduplication rusak permanen dan **tidak dapat dipulihkan** | Retirement memerlukan bukti migrasi lengkap + persetujuan tercatat; pemeriksaan startup gagal-tertutup bila ada record `LEGACY_PENDING_REVERIFICATION` sementara kunci versinya tidak tersedia | Startup check terbukti menolak boot pada kondisi tersebut; tidak ada jalur penghapusan kunci otomatis |
| R-6 | **Silent fallback** — sistem diam-diam memakai kunci lama tanpa jejak | Rotasi tidak dapat diaudit | Setiap lookup yang berhasil lewat kunci lama menerbitkan audit event `identifier.legacy_key_lookup` (hanya jenis identifier + keyVersion, **tanpa** nilai) | Audit event muncul pada setiap fallback; tidak ada jalur fallback tanpa event |

**Collision:** HMAC-SHA256 256-bit — probabilitas tabrakan dapat diabaikan. Tabrakan yang terdeteksi (unique violation dengan raw value berbeda) diperlakukan sebagai **security incident**, bukan error biasa, dan tidak boleh diselesaikan otomatis.

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

### 9.1 Keputusan Owner — APPROVED 2026-08-01

> **DIPUTUSKAN: AWS S3 private bucket, region `ap-southeast-3` (Jakarta), SSE-KMS dengan customer-managed key.**
> **Cloudflare R2 TIDAK dipilih untuk dokumen KYC produksi.**

Rekomendasi awal saya (R2) **digantikan** oleh keputusan ini. Saya mencatat bahwa keputusan Owner lebih kuat dari sisi kepatuhan: R2 tidak menyediakan customer-managed key maupun Object Lock, dan keduanya adalah kontrol yang paling relevan untuk dokumen KYC. Trade-off yang diterima adalah biaya egress dan kompleksitas IAM yang lebih tinggi.

**Rationale (D-01, D-02, D-03):**

| Aspek | Konsekuensi keputusan |
|---|---|
| Data residency | Dokumen KYC produksi disimpan di Jakarta — menutup risiko L-1 tanpa menunggu kesimpulan legal, karena menyimpan di dalam negeri adalah posisi paling konservatif |
| Customer-managed KMS key | Kunci dapat dicabut/dirotasi independen dari provider; penghapusan kunci menjadi kontrol penghapusan tambahan |
| Object Lock tersedia | Legal hold dapat ditegakkan di lapisan storage, bukan hanya aplikasi |
| Audit logging | CloudTrail + S3 server access log memberi jejak akses objek yang dapat diaudit |
| Kompatibilitas | `@aws-sdk/client-s3` — SDK yang sama juga akan bekerja bila kelak berpindah ke storage S3-compatible lain |

**Ketentuan mengikat yang menyertai D-03:**

- **Dedicated KMS key khusus dokumen KYC.** Kunci ini **tidak boleh** dipakai untuk payment, JWT, database, atau layanan lain.
- Least-privilege key policy; penggunaan kunci diaudit.
- **S3 Block Public Access aktif otomatis** pada bucket dan account level.
- Bucket **privat**; **tidak ada permanent public URL** dalam kondisi apa pun.

**Tidak dipakai:** Cloudflare R2 (untuk KYC produksi), Cloudinary (public-by-default, sudah ada di `env.ts` tetapi tidak dipakai kode — lihat G-9), Supabase Storage.

### 9.2 Risiko & prasyarat atas keputusan yang diambil

| Item | Catatan |
|---|---|
| Risiko IAM | Kompleksitas kebijakan IAM/KMS lebih tinggi → salah konfigurasi adalah risiko utama (T-10). Wajib IaC dan pemeriksaan startup fail-closed |
| Risiko biaya | Egress berbayar; reviewer yang sering mengunduh menaikkan biaya. Mitigasi: TTL presigned pendek dan tanpa CDN, sehingga volume unduhan terkendali dan terukur |
| Risiko kunci | Penghapusan/disable KMS key membuat objek **tidak dapat didekripsi permanen**. Wajib prosedur perlindungan kunci dan larangan penghapusan tanpa persetujuan tercatat |
| Prasyarat | Bucket privat + Block Public Access, versioning aktif, lifecycle rule, kredensial least-privilege **terpisah per environment** (`dev`/`staging`/`production`), KMS key khusus KYC |
| Dampak operasional | Dependency baru `@aws-sdk/client-s3`; rotasi kredensial; runbook incident; pemantauan biaya egress |

**Catatan penting:** keputusan D-01 s.d. D-03 **tidak** membuka blokir upload dokumen. Batch 6 tetap NO-GO sampai D-04, D-07 s.d. D-10, D-11 s.d. D-16, serta L-1 dan L-2 selesai.

**LEGAL REVIEW REQUIRED (L-1) tetap berlaku:** keputusan menyimpan di Jakarta adalah posisi konservatif yang menutup risiko, tetapi **tidak menggantikan** kajian legal tentang regulasi mana yang mengikat (perlindungan data pribadi, ketentuan sektor transportasi, kewajiban penyelenggara sistem elektronik). Hal ini tidak dapat dibuktikan dari repository dan tidak saya simpulkan sendiri.

---

## 10. Recommended Storage Architecture

**PROPOSAL ONLY — NOT IMPLEMENTED.** Arsitektur di bawah mengikuti keputusan D-01/D-02/D-03 (APPROVED 2026-08-01).

- **AWS S3 private bucket, region `ap-southeast-3` (Jakarta).**
- **SSE-KMS dengan customer-managed key khusus dokumen KYC** — kunci tidak dipakai untuk payment, JWT, database, atau layanan lain; least-privilege key policy; penggunaan kunci diaudit.
- **S3 Block Public Access aktif** pada bucket dan account level; bucket privat; **tidak ada permanent public URL**.
- Satu bucket per environment (`dev` / `staging` / `production`) dengan kredensial berbeda; **tidak** berbagi bucket.
- **Object key tidak boleh mengandung** NIK, nama, nomor HP, email, plat, atau identifier mentah:
  `drivers/{applicationUuid}/{documentUuid}` — keduanya UUID acak, tidak dapat ditebak, tidak berkorelasi dengan identitas.
- Enkripsi at rest via SSE-KMS, TLS in transit.
- Versioning aktif; lifecycle rule mengikuti keputusan retensi (D-11 s.d. D-14, masih PENDING).
- Pemeriksaan startup **fail-closed**: backend menolak boot bila bucket terdeteksi publik atau KMS key tidak tersedia.
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

**Stage 5.13 belum dimulai.** Tabel di bawah adalah rencana; status GO hanya berarti *boleh masuk tahap perencanaan implementasi*, bukan izin menulis kode.

| # | Batch | Status setelah 2026-08-01 | Scope | Dependency | Modul terdampak | Migration | Test | Rollback | Security gate | Owner prerequisite | Tetap BLOCKED |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Schema foundation | **GO FOR IMPLEMENTATION PLANNING** | Enum + `RideDriverApplication` | — | `prisma/`, `modules/rides` | Additive | Non-destructive scan | Berhenti pakai tabel | Nol destructive | D-21 ✅, D-22 ✅ | Dokumen |
| 2 | Review claim/lease | **GO FOR IMPLEMENTATION PLANNING** | Claim/renew/release/decision + audit | 1 | `modules/rides` | — | Konkurensi 2 admin, lease expiry, renewal atomik | Revert | Nol double-approve | D-17 ✅, D-19 ✅ | — |
| 3 | Vehicle ownership | **GO FOR IMPLEMENTATION PLANNING** | `RideVehicle*` + partial unique + transfer | 1 | `modules/rides`, `prisma/` | Additive | Transfer race, satu active ownership | Revert | Nol dua pemilik aktif | D-18 ✅ | Verifikasi dokumen kendaraan |
| 4 | Identifier HMAC service | **GO FOR IMPLEMENTATION PLANNING** | Normalisasi + blind index + versioning + dual lookup | — | `core/security` baru | — | Determinisme, domain separation, rotasi, R-1..R-6 | Revert | Nol raw/HMAC di log | D-05 ✅, D-06 ✅ | — |
| 5 | Document **metadata only** | **NO-GO** | Status dokumen tanpa bytes | 1 | `modules/rides` | Additive | State machine | Revert | Nol bytes di DB | D-07, D-08, D-09 | Upload nyata |
| 6 | Private storage integration | **NO-GO** | AWS SDK, presigned, verifikasi | 5 | infra + `modules/rides` | — | Integration dengan mock | Feature flag | Bucket privat + KMS fail-closed | D-01 ✅, D-02 ✅, D-03 ✅, **D-04 PENDING** | Sampai D-04, D-07..D-16, L-1, L-2 |
| 7 | Malware scanning | **NO-GO** | Scan + quarantine | 6 | infra | — | File uji EICAR | Feature flag | Nol akses sebelum clean | D-10 | Sampai D-10 |
| 8 | Admin review API | **NO-GO** | Scope + endpoint + akses dokumen | 2,5,7 | `modules/rides`, `core/security` | — | RBAC/scope matrix | Revert | Nol akses tanpa scope | D-18b ✅ (scope), sisanya dokumen | Akses isi dokumen |
| 9 | Driver mobile onboarding | **NO-GO** | UI `com.xavindo.tapgo.driver` | 1–8 | `apps/driver_app` | — | Widget + live visual gate | Revert | Nol secret di klien | Rename package | Upload UI |
| 10 | Migration/backfill legacy | **NO-GO** | Deprecate + mapping | 1,3,4 | `prisma/`, script | Komentar saja | Data-quality | Tidak ada penghapusan | Nol plaintext baru | D-23 | Penghapusan |
| 11 | Security verification | **NO-GO** | Pentest internal, review log/retensi | 1–10 | seluruh | — | Threat model regression + R-1..R-6 | — | Seluruh T-01..T-20 | D-11..D-16 | — |
| 12 | Production rollout | **NO-GO** | Feature flag bertahap | 11 | infra | Deploy | Smoke | Matikan flag | Runbook incident | Semua | — |

**Catatan Batch 8:** D-18b sudah APPROVED sehingga *desain scope* dapat direncanakan bersama Batch 2, tetapi *akses isi dokumen* tetap NO-GO karena bergantung pada Batch 5–7.

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
| **Rotasi HMAC hanya dapat lazy** (§8.5) | Kunci lama tertahan; deduplication tidak lengkap selama window | Dual lookup wajib + `indexMigrationState` + retirement hanya dengan bukti migrasi. Rincian risiko R-1 s.d. R-6 dan acceptance criteria ada di §8.5.3 |
| **Penghapusan KMS key tidak dapat dipulihkan** (D-03) | Objek tidak dapat didekripsi permanen | Prosedur perlindungan kunci; larangan penghapusan tanpa persetujuan tercatat; pemantauan key policy |
| Biaya egress S3 (D-01/D-02) | Biaya naik seiring frekuensi unduhan reviewer | TTL presigned pendek, tanpa CDN, pemantauan biaya |

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

**APPROVED 2026-08-01 (11 keputusan):** D-01 provider · D-02 region · D-03 KMS · D-05 HMAC key custody · D-06 rotasi HMAC · D-17 lease review · D-18 transfer kendaraan · D-18b reviewer scopes · D-19 reaktivasi · D-21 status `WITHDRAWN` · D-22 keunikan SIM.

**MASIH PENDING (13 keputusan):** D-04 enkripsi raw identifier · D-07 daftar dokumen per tahap · D-08 selfie/liveness · D-09 ukuran maksimum & MIME allowlist · D-10 malware scanner · D-11 s.d. D-15 retensi & backup & audit log · D-16 otoritas legal hold · D-20 cooldown resubmit · D-23 timing migrasi legacy.

**Blocking per batch setelah revisi:**

| Batch | Prasyarat | Status |
|---|---|---|
| 1–4 | D-05, D-06, D-17, D-18, D-19, D-21, D-22 | **seluruhnya APPROVED → GO** |
| 5 | D-07, D-08, D-09 | PENDING |
| 6 | D-04 (D-01/02/03 sudah APPROVED) | PENDING |
| 7 | D-10 | PENDING |
| 8 | Batch 5–7 (D-18b sudah APPROVED) | PENDING |
| 10 | D-23 | PENDING |
| 11 | D-11 s.d. D-16 | PENDING |
| Semua batch dokumen | L-1, L-2 | LEGAL REVIEW REQUIRED |

---

## 24. Go/No-Go Recommendation

**Diperbarui 2026-08-01 setelah Owner Decision.**

### GO FOR IMPLEMENTATION PLANNING — Batch 1, 2, 3, 4

Seluruh prasyarat keputusan sudah APPROVED. Keempat batch tidak menyentuh dokumen sama sekali, seluruhnya additive, dan menutup gap paling berbahaya (G-1 s.d. G-6) — termasuk mengganti SHA-256 unsalted pada plat dengan blind index HMAC ber-versi.

Catatan: **D-20 (cooldown resubmit) masih PENDING tetapi tidak memblokir Batch 1.** Bila belum diputuskan saat perencanaan, resubmit dijalankan tanpa cooldown dan aturan pembatas ditambahkan kemudian sebagai perubahan terpisah — bukan diasumsikan diam-diam.

**"GO" di sini berarti boleh menyusun rencana implementasi terperinci, bukan izin menulis kode.** Stage 5.13 hanya dimulai atas instruksi Owner yang eksplisit.

### NO-GO — Batch 5 dan seterusnya

Tetap diblokir sampai D-04, D-07 s.d. D-10, D-11 s.d. D-16, serta L-1 dan L-2 selesai. **Persetujuan D-01 s.d. D-03 tidak membuka blokir upload dokumen** — provider, region, dan KMS hanyalah satu dari tujuh syarat yang ditetapkan Owner Decision 12.

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

**Ringkasan: 11 APPROVED (2026-08-01) · 13 PENDING.**

### 26.1 Keputusan APPROVED — 2026-08-01

| ID | Question | Keputusan | Rationale | Consequences | Blocking stage | Status |
|---|---|---|---|---|---|---|
| D-01 | Private object-storage provider? | **AWS S3 private bucket.** Cloudflare R2 tidak dipilih untuk KYC produksi | R2 tidak menyediakan customer-managed key maupun Object Lock — dua kontrol paling relevan untuk KYC | Menerima biaya egress dan kompleksitas IAM lebih tinggi; butuh `@aws-sdk/client-s3` | Batch 6 | **APPROVED** |
| D-02 | Storage region? | **`ap-southeast-3` (Jakarta).** Seluruh dokumen KYC produksi di region ini kecuali ada ADR baru | Posisi paling konservatif terhadap data residency; menutup risiko L-1 tanpa menunggu kesimpulan legal | Latensi lintas region untuk komponen di luar ID; perubahan region memerlukan ADR baru | Batch 6 | **APPROVED** |
| D-03 | KMS / customer-managed key? | **SSE-KMS dengan customer-managed key khusus KYC.** Dedicated key; tidak dipakai payment/JWT/database/layanan lain; least-privilege policy; key usage diaudit; Block Public Access otomatis; bucket privat; tanpa permanent public URL | Pemisahan kunci membatasi radius kompromi; pencabutan kunci menjadi kontrol penghapusan tambahan | Biaya KMS + ops rotasi; **penghapusan/disable kunci membuat objek tidak dapat didekripsi permanen** → butuh prosedur perlindungan kunci | Batch 6 | **APPROVED** |
| D-05 | HMAC key custody? | **Khusus backend; production secret manager.** Tidak di source code, database, mobile app, atau repository. Terpisah dari JWT, payment, storage, KMS, dan kredensial database. Hanya tersedia bagi backend runtime yang memerlukan deduplication. Nama env var tetap proposal sampai implementation review, tetapi wajib mendukung versioning (`IDENTIFIER_INDEX_KEY_V1`, `IDENTIFIER_INDEX_KEY_V2`) | Kompromi satu kunci tidak meruntuhkan domain lain | Perlu integrasi secret manager dan runbook rotasi | Batch 4 | **APPROVED** |
| D-06 | Rotasi kunci HMAC? | **12 bulan terjadwal + rotasi segera saat insiden.** Kunci ber-versi; maksimal dua versi aktif; setiap blind index menyimpan `keyVersion`; tidak ada silent fallback tanpa audit; kunci lama tidak dihapus sebelum record dimigrasikan, diverifikasi ulang, atau dinyatakan tidak dapat digunakan | Membatasi dampak kebocoran tanpa merusak deduplication | **Migrasi hanya lazy** — lihat koreksi §8.5; menimbulkan risiko R-1 s.d. R-6 yang wajib dimitigasi | Batch 4 | **APPROVED** |
| D-17 | Durasi reviewer claim? | **15 menit default**, dapat diperpanjang reviewer aktif; renewal atomik; keputusan hanya sah bila claim masih dimiliki actor dan belum expired; lease expired dapat diambil reviewer lain lewat atomic claim; reviewer lama tidak boleh memutuskan setelah lease berpindah; seluruh claim/renewal/release/expiry/reassignment/approve/reject diaudit | Menyeimbangkan pencegahan review ganda dengan risiko antrean macet | Reviewer harus memperpanjang untuk kasus panjang; butuh endpoint renewal | Batch 2 | **APPROVED** |
| D-18 | Aturan transfer kendaraan? | **Wajib admin review dengan explicit scope**; verifikasi dokumen kendaraan baru; transaksi atomik; tutup ownership lama sebelum aktifkan yang baru; pertahankan history; tolak dua active ownership untuk kendaraan/plate sama; catat actor, reason, timestamp, source & target ownership | Mencegah substitusi kendaraan (T-19) | Beban admin bertambah; verifikasi dokumen kendaraan bergantung pada batch dokumen | Batch 3 | **APPROVED** |
| D-18b | Reviewer scopes? | **Explicit scopes, bukan role.** Minimal: `driver.review.claim`, `driver.review.read`, `driver.review.decide`, `driver.review.reassign`, `vehicle.transfer.review`, `kyc.document.read`, `kyc.document.audit`. Nama final dapat disesuaikan dengan arsitektur authorization existing, **semantics tidak boleh dilemahkan**. ADMIN/SUPER_ADMIN tidak otomatis memperoleh akses isi dokumen KYC | Least privilege; memisahkan kewenangan review dari akses isi dokumen | Memperkenalkan konsep scope yang belum ada (G-12); butuh model penyimpanan & pemberian scope | Batch 8 | **APPROVED** |
| D-19 | Reaktivasi driver? | **Hanya melalui manual review** setelah alasan suspension diselesaikan, dokumen wajib masih valid, tidak ada unresolved security/fraud restriction, reviewer memiliki explicit scope, dan keputusan + reason tercatat di audit trail. **Tidak boleh mengubah `User.role`** | Mencegah pemulihan diam-diam | Reaktivasi tidak dapat otomatis; bergantung validitas dokumen (batch dokumen) | Batch 2 | **APPROVED** |
| D-21 | Status `WITHDRAWN`? | **Ya — terminal status** untuk application cycle yang ditarik user. Hanya applicant sah yang dapat menarik application yang masih eligible; withdrawal idempotent; application lama tidak diaktifkan kembali; resubmission membuat cycle baru; histori dan audit trail dipertahankan | Jejak audit lebih jujur daripada menghapus `DRAFT` | Menambah satu status terminal pada enum aplikasi | Batch 1 | **APPROVED** |
| D-22 | Keunikan SIM? | **Satu nomor SIM hanya boleh terhubung dengan satu identitas driver.** Deduplication memakai versioned deterministic keyed HMAC blind index; leading zero dan format canonical konsisten; **konflik tidak diselesaikan otomatis** → wajib admin review + audit trail; nomor SIM **tidak dapat ditransfer** seperti kendaraan; raw SIM tidak boleh dicetak ke log atau disimpan tanpa kebutuhan dan encryption yang disetujui | Mencegah satu SIM dipakai banyak akun | Perlu alur resolusi konflik manual; normalisasi canonical wajib diuji ketat | Batch 1 | **APPROVED** |

### 26.2 Keputusan masih PENDING

| ID | Question | Recommended | Alternatives | Security impact | Cost/ops impact | Blocking stage | Status |
|---|---|---|---|---|---|---|---|
| D-04 | Raw identifier perlu dapat dibaca kembali? | **Tidak** — blind index + masking saja | Envelope encryption | Menyimpan raw menambah risiko besar | Perlu utilitas enkripsi baru (belum ada, G-10) | Batch 4/6 | PENDING |
| D-07 | Dokumen wajib per tahap onboarding? | SIM + STNK saat submit; sisanya menyusul | Semua di depan | Lebih sedikit data = lebih aman | UX | Batch 5 | PENDING |
| D-08 | Selfie/liveness wajib? | Ya untuk anti-impersonation | Tidak | Menurunkan driver palsu | Biaya vendor | Batch 5 | PENDING |
| D-09 | Ukuran file maksimum & MIME allowlist? | 8 MB; `image/jpeg`, `image/png`, `application/pdf` | 5/10 MB; + HEIC | Membatasi malicious upload | Storage | Batch 5 | PENDING |
| D-10 | Malware scanner? | ClamAV terkelola atau GuardDuty Malware Protection for S3 | Vendor pihak ketiga | Wajib sebelum akses reviewer | Biaya + latensi | Batch 7 | PENDING |
| D-11 | Retensi aplikasi rejected? | 90 hari | 30/180 hari | Data minimization | Storage | Batch 11 | PENDING |
| D-12 | Retensi driver approved? | Selama hubungan + periode legal | Tetap | Kepatuhan | Storage | Batch 11 | PENDING |
| D-13 | Deletion SLA? | 30 hari sejak pemicu | 7/90 hari | Kepercayaan pengguna | Ops | Batch 11 | PENDING |
| D-14 | Retensi backup? | Selaras retensi dokumen, maks 35 hari | Lebih lama | Backup menahan data terhapus | Biaya | Batch 11 | PENDING |
| D-15 | Retensi audit log? | 24 bulan | 12 bulan | Investigasi | Storage | Batch 11 | PENDING |
| D-16 | Otoritas legal hold? | Security/compliance, dua orang | Super admin tunggal | Mencegah penyalahgunaan | Proses | Batch 11 | PENDING |
| D-20 | Cooldown resubmit setelah rejected? | 7 hari, maks 3 kali | Tanpa batas | Mengurangi spam | UX | Batch 1 (tidak memblokir) | PENDING |
| D-23 | Kapan menghapus model legacy? | Stage terpisah setelah bukti migrasi | Sekarang | Penghapusan dini berisiko | — | Batch 10 | PENDING |

**Seluruh item LEGAL REVIEW REQUIRED (L-1 s.d. L-6) tetap terbuka.**

---

*Akhir dokumen. Stage 5.12 belum disetujui.*
