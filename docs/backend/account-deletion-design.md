# Desain Account Deletion & Retention (P1-5)

Status: **DESAIN — hard-delete BELUM diimplementasikan (blocker legal).**

Tahap ini hanya merancang. Tidak ada penghapusan/anonymization destruktif yang
dijalankan karena kebijakan legal/retensi belum diputuskan owner.

## Kondisi saat ini (audit)

- Endpoint: `GET/POST /api/v1/account/delete-request`
  ([account.routes.ts](../../apps/backend/src/modules/account/presentation/account.routes.ts)),
  keduanya di belakang `requireAuth`.
- Ownership aman: query di-scope ke `req.auth!.userId`; user tidak dapat
  membaca/membuat request milik user lain (terverifikasi di
  `tests/account/accountDeletion.integration.test.ts`).
- POST idempotent selama masih ada request `PENDING`.
- Model `AccountDeletionRequest` sudah memiliki `status`, `reviewedBy`,
  `reviewedAt`, `completedAt` — cukup untuk state machine.
- **Belum ada** eksekusi: tidak ada kode yang mengubah status atau
  menghapus/menganonimkan data. Admin console hanya `count`/`findMany`.

## State machine yang diusulkan

```
REQUESTED (PENDING)
   │  admin approve                    admin reject
   ├──────────────▶ APPROVED ──▶ PROCESSING ──▶ COMPLETED
   │                                  │
   └──────────────▶ REJECTED          └─(gagal)─▶ (tetap PROCESSING, retry)
   │
   └── user/admin cancel ──▶ CANCELLED
```

Enum `AccountDeletionRequestStatus` saat ini: `PENDING, APPROVED, REJECTED,
COMPLETED`. Untuk mendukung state machine penuh diperlukan tambahan
`PROCESSING` dan `CANCELLED` melalui **additive migration** (belum dibuat pada
tahap ini). Transisi hanya boleh maju dan tercatat di `reviewedBy`/`reviewedAt`/
`completedAt` + audit log.

## Matriks retention / anonymization

Klasifikasi per kategori data ketika sebuah akun benar-benar diproses hapus.
**Keputusan final menunggu kebijakan legal** (periode retensi pajak/keuangan,
kewajiban anti-fraud, dan regulasi perlindungan data).

| Kategori | Tindakan diusulkan | Alasan | Catatan |
|---|---|---|---|
| Profil user (nama, phone, email, password) | **Anonymize** (redaksi PII, `status = DELETED`) | Menjaga integritas relasi (referral, invoice) tanpa menyimpan PII | Jangan hard-delete row `users` karena banyak FK |
| Session & refresh token | **Delete** | Tidak ada nilai retensi; cabut akses | Segera saat COMPLETED |
| Member identity (public code) | **Retain (anonymized owner)** | Kode publik historis; putus kaitan ke PII | — |
| Invoice & membership order | **Retain** | Kewajiban pembukuan/pajak | Periode retensi = **BLOCKER legal** |
| Payment records | **Retain** | Rekonsiliasi & anti-fraud | Idem |
| Wallet & wallet ledger | **Retain (freeze)** | Audit finansial; saldo/komisi historis | Tidak boleh menghapus ledger |
| Commission / bonus / reward | **Retain** | Konsistensi jaringan & audit payout | — |
| Referral & referral levels | **Retain (anonymized)** | Menghapus akan merusak genealogy downline lain | Jangan putus pohon |
| Support ticket & message | **Anonymize** (redaksi isi PII) atau retain | Bukti layanan; isi bisa mengandung PII | Tergantung kebijakan |
| Legal/contact request | **Retain** | Bukti persetujuan/permintaan | — |
| Audit log | **Retain (immutable)** | Wajib untuk forensik | Tidak pernah dihapus |
| Registration event / abuse flag | **Retain** | Anti-abuse | — |

Prinsip: **delete** hanya untuk data akses/kredensial; **anonymize** untuk PII
yang tertaut ke record yang harus dipertahankan; **retain** untuk record
finansial/audit/legal dan struktur jaringan.

## Prosedur eksekusi COMPLETED (DESAIN — belum diimplementasikan)

Keputusan owner: account deletion **tidak boleh** menghapus catatan
transaksi/keuangan/audit secara langsung. Currency transaksi = IDR. Maka saat
sebuah request diproses hingga `COMPLETED`, urutan yang dirancang:

1. **Revoke akses:** cabut semua session & refresh token milik user (hapus baris
   session / set `revokedAt`), sehingga sesi aktif langsung tidak berlaku.
2. **Nonaktifkan login:** set `users.status = DELETED` agar `AuthService` menolak
   login (sudah ada guard `ACCOUNT_INACTIVE`).
3. **Anonymize PII yang tidak wajib disimpan:** redaksi `fullName`, `phone`,
   `email`, dan isi personal support ticket menjadi nilai ter-anonim; putus
   kaitan ke `memberIdentity` tanpa menghapus kodenya.
4. **PERTAHANKAN (retain):** invoice, membership order, payment, wallet & ledger,
   commission/bonus/reward, referral & genealogy, audit log, registration event,
   abuse flag, dan catatan legal/contact — untuk kewajiban keuangan, audit,
   anti-fraud, dan hukum.

State kandidat: `PENDING` → `PROCESSING` → `COMPLETED`, atau `REJECTED` /
`CANCELLED`. Enum saat ini (`PENDING/APPROVED/REJECTED/COMPLETED`) perlu tambahan
`PROCESSING` dan `CANCELLED` via **additive migration** (belum dibuat).

Tahap ini tetap **design/documentation only** — tidak ada destructive deletion
yang diimplementasikan.

## Blocker yang harus diputuskan owner sebelum implementasi eksekusi

1. Periode retensi record finansial (invoice, payment, wallet ledger) sesuai
   kewajiban pajak/akuntansi Indonesia.
2. Apakah isi support ticket dianonimkan atau dipertahankan.
3. Kebutuhan konfirmasi/verifikasi user sebelum COMPLETED (mis. OTP / grace
   period pembatalan).
4. SLA & alur admin (siapa yang approve; apakah ada PROCESSING otomatis).

Sampai keputusan di atas ada, jangan mengimplementasikan hard-delete atau job
anonymization. Endpoint request tetap berfungsi sebagai penampung permintaan.
