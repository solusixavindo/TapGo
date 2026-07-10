# Migration Sequence Review

Tanggal: 17 Juni 2026

Scope: review konflik urutan migration sebelum deploy production. Tidak ada migration yang dijalankan.

## Temuan

Repo saat ini memiliki migration:

- `apps/backend/prisma/migrations/0013_legal_contact_requests`
- `apps/backend/prisma/migrations/0013_anti_abuse_registration_monitoring`

Ini bukan nama folder yang identik, tetapi prefix nomor `0013` bertabrakan dan dapat membingungkan operator saat review/deploy.

## Risiko

| Risiko | Dampak |
| --- | --- |
| Dua migration memakai prefix `0013` | Urutan mental/operator tidak jelas |
| Deploy production terburu-buru | Salah asumsi migration mana yang sudah jalan |
| Audit rollback sulit | Runbook sulit dibaca |

## Rekomendasi

Sebelum deploy production, rename anti-abuse migration menjadi nomor berikutnya:

```text
0014_anti_abuse_registration_monitoring
```

Atau gunakan nomor berikutnya sesuai urutan migration final repo jika ada migration baru lain.

## Kenapa Tidak Direname Sekarang

Instruksi task meminta:

- Jangan jalankan migration.
- Jangan deploy.
- Jangan rename otomatis jika belum yakin urutan migration repo.

Karena itu dokumen ini hanya memberi rekomendasi. Rename dilakukan pada tahap release preparation setelah owner/dev lead menyetujui urutan final.

## Checklist Sebelum Rename

- [ ] Pastikan `0013_anti_abuse_registration_monitoring` belum pernah dijalankan di production.
- [ ] Pastikan belum tercatat di `_prisma_migrations` production.
- [ ] Rename folder migration di repo.
- [ ] Update semua laporan/runbook yang menyebut nama migration.
- [ ] Jalankan `npx prisma validate`.
- [ ] Jalankan migration di test/staging DB.
- [ ] Baru lanjut production setelah backup.

## Command Review Production Migration Table

Jalankan nanti di VPS dengan read-only DB access:

```sql
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY finished_at NULLS LAST, migration_name;
```

## Decision

Status: **RENAME REQUIRED BEFORE PRODUCTION DEPLOY**

Rekomendasi nama: `0014_anti_abuse_registration_monitoring`.

