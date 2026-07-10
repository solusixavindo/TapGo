# Admin Audit Trail Review TapGo

Tanggal: 2026-06-17

## Scope

Audit ini menilai apakah aksi Admin/Super Admin penting sudah memiliki jejak audit yang memadai. Audit dilakukan dari source lokal tanpa menjalankan migration, tanpa deploy, dan tanpa menyentuh production database.

Source utama:

- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/modules/memberships/infrastructure/PrismaMembershipRepository.ts`
- `apps/backend/src/modules/wallets/infrastructure/PrismaWalletRepository.ts`
- `apps/backend/src/modules/admin-console/application/AdminConsoleService.ts`
- `apps/backend/src/modules/admin-console/presentation/admin-console.routes.ts`
- `apps/backend/src/modules/profit-sharing/application/ProfitSharingService.ts`

## AuditLog Model

Schema menyediakan model:

```text
AuditLog
- actorId
- action
- entityType
- entityId
- metadata
- ipAddress
- createdAt
```

Status: **PARTIAL PASS**

Kekuatan:

- Sudah ada struktur umum untuk audit trail.
- Sudah ada index `actorId, createdAt` dan `entityType, entityId`.

Kelemahan:

- Belum semua aksi admin memakai `AuditLog`.
- `ipAddress` tersedia tetapi tidak selalu diisi dari request.
- Beberapa aksi menyimpan adminId di metadata entity, bukan audit log terpusat.

## Matrix Aksi Admin

| Aksi | Status Audit Trail | Bukti/Temuan | Risiko |
| --- | --- | --- | --- |
| Admin login | WARNING | Auth session mencatat device/ip context, tetapi tidak terlihat audit log eksplisit `ADMIN_LOGIN`. | Sulit investigasi akses admin. |
| Admin approve membership | PASS | Membership upgrade menulis `MEMBERSHIP_UPGRADED`; admin member approval membawa adminId. | Perlu pastikan semua jalur approval menulis audit log. |
| Admin reject membership | WARNING | Reject member request menerima `adminId` dan reason, tetapi perlu konfirmasi audit log terpusat. | Reason bisa tersebar di record, tidak konsisten. |
| Super admin action | WARNING | Beberapa route dibatasi `SUPER_ADMIN`, tetapi audit log tidak merata. | Aksi sensitif tidak selalu tercatat terpusat. |
| Withdrawal approval | PASS | `approvedBy`, `approvedAt`, `reviewedBy`, `reviewedAt`, note; ada log `WITHDRAWAL_APPROVED`. | Belum terlihat guard mencegah approve withdrawal milik sendiri. |
| Withdrawal rejection | PASS | Ada `rejectedBy`, `rejectedAt`, note dan log admin action. | Perlu SOP dual control untuk nominal besar. |
| Withdrawal paid | WARNING | Super Admin only, ada adminId/note; perlu audit log eksplisit untuk bukti transfer. | Risiko payout tanpa lampiran bukti. |
| Reward approval | WARNING | `approvedBy` disimpan di metadata reward. Tidak terlihat audit log terpusat. | Audit reward tersebar di metadata. |
| Reward rejection | WARNING | `rejectedBy`, `rejectReason` di metadata. | Perlu log terpusat. |
| Reward mark paid | WARNING | `paidBy`, `paidNote` di metadata dan wallet transaction dibuat. | Perlu log terpusat dan bukti payout. |
| Profit sharing approval | WARNING | Super Admin route; service mengubah status approved. Tidak terlihat actorId di service approvePeriod. | Aksi besar perlu actorId, note, audit log. |
| Profit sharing distribution | WARNING | Super Admin route; distribusi menghasilkan ledger. Perlu actorId eksplisit. | Risiko distribusi besar tanpa audit actor. |
| Wallet adjustment | WARNING | Ada transaction type `ADJUSTMENT`; perlu membatasi dan audit actor. | Perubahan saldo manual wajib audit ketat. |
| User status change | WARNING | Belum terlihat audit trail khusus status user. | Suspend/delete/activate perlu actor/reason. |
| Role change | WARNING | Route role hanya Super Admin, tetapi terlihat placeholder route. | Role change wajib audit log dan reason. |
| Package/config change | PASS | `MEMBERSHIP_RULES_UPDATED` audit log ada. | Pastikan semua config penting memakai pola sama. |
| Viewing/downloading sensitive docs | FAIL | Belum ditemukan audit trail view/download dokumen sensitif. | Risiko compliance tinggi jika KTP/selfie/rekening diakses admin. |

## Risiko yang Ditemukan

| Risiko | Prioritas | Dampak |
| --- | --- | --- |
| Reward/profit sharing belum memakai audit log terpusat | P1 | Sulit rekonsiliasi payout besar. |
| Admin login belum dicatat eksplisit | P1 | Sulit investigasi penyalahgunaan akun admin. |
| Sensitive document access belum diaudit | P1 | Risiko privacy/compliance. |
| Self-approval withdrawal belum terlihat guard eksplisit | P1 | Risiko konflik kepentingan. |
| Role/status changes belum audit lengkap | P1 | Risiko privilege abuse. |
| `ipAddress` audit log tidak selalu diisi | P2 | Investigasi forensik kurang lengkap. |

## Rekomendasi Before Public Launch

P1:

1. Tambahkan service audit terpusat untuk seluruh action admin penting.
2. Tambahkan audit `ADMIN_LOGIN`, `ADMIN_LOGOUT`, `ROLE_CHANGED`, `USER_STATUS_CHANGED`.
3. Tambahkan actorId, ipAddress, userAgent, reason/note pada aksi reward/profit sharing.
4. Tambahkan audit untuk view/download dokumen sensitif.
5. Tambahkan guard withdrawal: admin tidak boleh approve request miliknya sendiri; nominal besar butuh Super Admin.

P2:

1. Standardisasi metadata audit: before/after, entity reference, request id.
2. Tambahkan export audit log untuk Super Admin.
3. Tambahkan retention policy audit log.

## Rekomendasi Schema Jika Dibutuhkan Nanti

Jangan dibuat sekarang tanpa approval owner.

```text
admin_action_logs
- id
- actor_id
- actor_role
- action
- entity_type
- entity_id
- before_snapshot
- after_snapshot
- reason
- note
- ip_address
- user_agent
- request_id
- created_at
```

Alternatif aman: lanjutkan model `AuditLog` existing, tetapi wajib dipakai konsisten oleh semua service.

## Kesimpulan

Status: **WARNING**

TapGo sudah memiliki pondasi audit trail, tetapi belum cukup kuat untuk public launch dengan operasi finansial penuh. Closed Testing masih aman, tetapi public launch perlu hardening audit log untuk reward, profit sharing, sensitive document access, role/status change, dan admin login.
