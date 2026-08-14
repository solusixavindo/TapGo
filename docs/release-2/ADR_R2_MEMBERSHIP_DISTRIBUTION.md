# ADR — Release 2 Membership Distribution and Governance

> **Binding architecture decision.** Ditetapkan Owner pada Stage R2.1A.
> Dokumen ini tidak mengubah `STAGE_R2_0_INTEGRATION_RECONCILIATION.md`, yang
> berstatus APPROVED & FREEZE.

Status: **ACCEPTED** · Berlaku sejak Release 2

---

## 1. Konteks

Release 2 mencakup enam area: Auth Recovery & Contact Verification, Membership,
PPOB, Ojek Online Customer, TapGo Driver App, dan Admin Operations.

Distribusi:

| Kanal | Identitas |
|---|---|
| Customer app | `com.xavindo.tapgo` |
| Driver app | `com.xavindo.tapgo.driver` |
| Admin | sistem web/admin |
| Membership | **bukan aplikasi Play Store ketiga** |

## 2. Keputusan

**Portal Membership berada di dalam `com.xavindo.tapgo`.** Membership tidak
diterbitkan sebagai aplikasi terpisah.

**Pembelian dan upgrade dilakukan melalui website resmi TapGo** menggunakan
akun yang sama dengan aplikasi.

**Sebelum Play Policy Review, aplikasi tidak boleh memuat:**

- in-app checkout;
- payment WebView;
- external payment link;
- purchase CTA dalam bentuk apa pun.

Pembayaran di website dapat diproses otomatis melalui verified payment webhook.

## 3. State standar

```
PENDING → PAID → FULFILLMENT_PENDING → ACTIVE
```

| Tier | Jalur aktivasi |
|---|---|
| Basic | otomatis sesuai business rule |
| Silver / Gold / Platinum | otomatis setelah pembayaran dan requirement valid |
| **Founder Platinum** | **wajib explicit admin approval, cap 10** |
| **Chairman** | **hanya manual melalui explicit authority** |

## 4. Aturan yang mengikat

1. Payment callback **tidak boleh** menghasilkan Founder Platinum maupun Chairman.
2. Founder Platinum maksimum **10 akun aktif**.
3. Chairman **wajib unik**.
4. Keduanya tidak boleh dibuat lewat ordinary membership purchase, tidak boleh
   auto-upgrade maupun auto-downgrade, dan tidak boleh berubah akibat Auth,
   Driver, Ride, PPOB, referral, reward, payment callback, maupun migration.
5. Admin menangani verification, fulfillment, exception, refund, dispute, dan
   reconciliation.
6. Setiap perubahan status khusus wajib meninggalkan audit trail.

## 5. Status penegakan saat ini — terverifikasi Stage R2.1A

Audit dan pengujian dilakukan pada candidate tree Release 2.

| Aturan | Lapisan penegakan | Status |
|---|---|---|
| Chairman unik | **partial unique index database** `founder_program_grants_one_chairman_key` | **TERBUKTI** |
| Founder Platinum cap 10 | transaksi `AdminConsoleService` ber-isolation **Serializable** | **TERBUKTI** |
| Hanya SUPER_ADMIN | route admin + `requireRoles` | **TERBUKTI** — ADMIN dan USER ditolak 403 |
| Payment callback tidak dapat membuat grant | tabel grant hanya ditulis `AdminConsoleService` | **TERBUKTI** |
| Auth tidak mengubah grant | pencabutan berversi hanya menyentuh kolom auth pada `users` | **TERBUKTI** |
| Audit trail | `granted_by`, `reason`, `AuditLog` | **TERBUKTI** |

Sepuluh test pada `tests/memberships/founderProtection.integration.test.ts`
mengunci seluruh baris di atas. **Nol perubahan business implementation
diperlukan** — aturannya memang sudah berlaku.

### 5.1 Dua observasi yang perlu keputusan Owner

**O-1 — Chairman tidak dapat diganti setelah dicabut.** Index unik tidak
memuat predikat `revoked_at IS NULL`, sehingga keunikannya dihitung terhadap
SELURUH baris termasuk yang sudah dicabut. Begitu satu Chairman pernah
diberikan, Chairman berikutnya tidak akan pernah dapat dibuat lewat jalur
normal. Ini fail-closed — aman, tetapi kaku secara operasional. Bila
penggantian Chairman termasuk skenario yang sah, index perlu diubah menjadi
partial dengan predikat aktif.

**O-2 — pecundang balapan muncul sebagai kegagalan tak ramah.** Pada dua grant
serentak, transaksi yang kalah dibatalkan PostgreSQL sebagai serialization
failure dan diteruskan sebagai kegagalan generik, bukan 409 yang jelas. Batas
tetap terjaga — hitungan tidak pernah melewati 10 — tetapi pengalaman admin
kurang baik dan log memuat pesan write-conflict. Penambahan retry atau
pemetaan error yang rapi layak dipertimbangkan.

Keduanya **tidak** memblokir Release 2 dan **tidak** diperbaiki pada Stage
R2.1A, sesuai instruksi untuk tidak memperbaiki area Membership diam-diam.

## 6. Konsekuensi

- Aplikasi customer tetap mematuhi kebijakan Play selama tidak ada purchase CTA.
- Website menjadi satu-satunya titik transaksi membership sampai Play Policy
  Review selesai.
- Founder Platinum dan Chairman tetap berada sepenuhnya di jalur administratif.
- Setiap perubahan pada aturan di §4 memerlukan ADR baru, bukan penyuntingan
  dokumen ini.
