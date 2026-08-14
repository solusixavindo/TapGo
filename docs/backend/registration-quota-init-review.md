# Review Inisialisasi Registration Quota (C)

Keputusan: **pertahankan pendekatan konservatif saat ini**; migration
`20260726090002_registration_quota_counter` **tidak diubah**.

## Pendekatan saat ini

```sql
granted = LEAST((SELECT COUNT(*) FROM "users" WHERE "role" = 'USER'), 1000)
```

Menghitung jumlah user `role=USER` yang sudah ada, di-cap 1000.

## Alternatif presisi yang dipertimbangkan

```sql
granted = LEAST((SELECT COUNT(*) FROM "wallet_transactions"
                 WHERE "type" = 'REGISTRATION_BONUS'
                   AND "reference_type" = 'BASIC_REGISTRATION'), 1000)
```

Menghitung penerima bonus aktual (setiap penerima memiliki satu
`walletTransaction` bertipe `REGISTRATION_BONUS`, dibuat di
[PrismaAuthRepository.ts](../../apps/backend/src/modules/auth/infrastructure/PrismaAuthRepository.ts)).

## Analisis

| Aspek | `COUNT(users role=USER)` (dipakai) | `COUNT(REGISTRATION_BONUS)` |
|---|---|---|
| Kesetaraan di Release 1 | Setiap user USER dibuat via registrasi `createUser`; user #1–1000 menerima bonus → **setara** dengan jumlah penerima | Sama untuk 1.000 pertama |
| Bila ada user USER non-registrasi (seed/admin tanpa bonus) | granted sedikit lebih tinggi → **under-grant** (slot berkurang), **tidak** over-grant | Lebih presisi (penerima aktual) |
| Ketergantungan | Hanya tabel `users` (sederhana, robust) | Bergantung metadata transaksi & konsistensi tipe |
| Risiko over-grant (>1.000) | **Tidak mungkin** (LEAST cap + CHECK `granted<=limit` + `WHERE granted<limit`) | Sama |

## Alasan mempertahankan pendekatan konservatif

1. **Tidak pernah over-grant.** Batas 1.000 dijamin berlapis: `LEAST(...,1000)`
   saat init, `WHERE "granted" < "limit"` saat klaim, dan CHECK constraint
   `registration_quota_within_limit`.
2. **Setara di Release 1.** Karena satu-satunya jalur pembuatan user USER adalah
   registrasi (yang memberi bonus ke 1.000 pertama), kedua metode menghasilkan
   angka sama pada database Release 1.
3. **Lebih sederhana & robust.** Tidak bergantung pada konsistensi metadata
   `wallet_transactions`.
4. **Migration sudah dibuat** — mengubahnya butuh alasan kuat (instruksi C.2);
   di praktik Release 1 tidak ada perbedaan hasil, sehingga tidak ada alasan
   kuat untuk mengubah.

## Kesimpulan

Data existing (`users`) sudah cukup authoritative untuk Release 1. Bila di masa
depan ada jalur pembuatan user USER non-registrasi dalam jumlah besar, init
dapat dipindah ke `COUNT(REGISTRATION_BONUS)` melalui **additive migration baru**
(bukan mengubah yang lama). Tidak ada mekanisme yang dapat memberikan bonus ke
lebih dari 1.000 user.
