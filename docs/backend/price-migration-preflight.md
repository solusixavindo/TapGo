# Pre-Deploy Guard: Harga Tier (D)

Migration `20260726090001_seed_tier_benefits` menetapkan **harga canonical
management** dan menimpa kolom `price` per tier. Dokumen ini adalah prosedur
**read-only** yang WAJIB dijalankan pada production **sebelum** menerapkan
migration, untuk mendeteksi apakah harga production berbeda (mis. pernah
di-override via admin console).

> Task hardening ini TIDAK mengakses production. Prosedur di bawah dijalankan
> oleh owner/operator saat deployment, dengan kredensial read-only.

## Harga canonical (keputusan owner)

| Tier | price | ppob_balance |
|---|---:|---:|
| BASIC | 0 | 0 (benefit Rp5.000 via kuota, bukan package price) |
| SILVER | 500000 | 100000 |
| GOLD | 3000000 | 600000 |
| PLATINUM | 5500000 | 1000000 |

## Langkah pre-deploy (READ ONLY)

1. Tampilkan harga & benefit tier production saat ini:

   ```sql
   SELECT tier, price, ppob_balance, bpjs_benefit, merchandise
   FROM memberships
   ORDER BY price;
   ```

2. Bandingkan dengan tabel canonical di atas.

3. **Gerbang keputusan:**
   - Jika `price` production **sama** dengan canonical (atau `ppob_balance`
     masih 0 karena belum di-seed) → aman melanjutkan migration.
   - Jika `price` production **berbeda** dari canonical untuk tier mana pun →
     **HENTIKAN deployment**. Migration akan menimpa harga tersebut. Minta
     keputusan owner apakah:
     a. harga canonical benar (lanjutkan), atau
     b. harga production yang benar (revisi migration sebelum deploy).

4. Catat hasil perbandingan pada runbook deployment sebelum melanjutkan.

## Verifikasi setelah deploy (READ ONLY)

```sql
SELECT tier, price, ppob_balance, bpjs_benefit, merchandise
FROM memberships
ORDER BY price;
```

Pastikan nilai sama dengan tabel canonical. Migration bersifat idempotent,
sehingga aman dijalankan ulang jika verifikasi memerlukan.

## Catatan

`merchandise` (JSONB) dan `bpjs_benefit` (TEXT) adalah **metadata entitlement**,
bukan penanda barang sudah dikirim/di-fulfill. Status fulfillment fisik/BPJS
dikelola di luar kolom ini.
