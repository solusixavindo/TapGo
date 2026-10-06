# TapGo user_app 2.0.5+41 — perbaikan hasil audit +40

Tanggal: 2026-10-06. Dasar: 2.0.5+40 (isi +40 tetap berlaku). `versionCode` 41. Pin tetap trust-anchor.

## Perbaikan (temuan audit mandiri)
1. **Saldo PPOB kurang saat bayar tampil "Terjadi kesalahan" generik** — kode yang dikirim backend
   (`INSUFFICIENT_PPOB_BALANCE`) tidak dikenali pemeta galat (hanya `INSUFFICIENT_BALANCE`). Kini pesan jelas
   "Saldo benefit PPOB tidak cukup…" (berlaku juga untuk PPOB prabayar).
2. **HP berjam salah dapat menganggap tagihan baru sudah kedaluwarsa** — batas bayar dihitung dari jam HP
   terhadap `expiresAt` server. Kini server mengirim `expiresInSeconds` dan aplikasi menghitung batasnya dari jam
   HP sendiri sejak respons diterima (cadangan: `expiresAt`). Tes memakai `expiresAt` tahun 2020 dengan sisa 540 dtk.

## Backend (butuh cutover, lihat catatan rilis +40)
- Daftar harga pascabayar diminta SEKALI per siklus (batas pengecekan Digiflazz rc=83; sebelumnya sinkronisasi harga
  dan katalog masing-masing meminta).
- Sinkronisasi katalog memakai batas waktu transaksi 60 detik (katalog PDAM bisa ratusan baris).
- Saklar sendiri `PPOB_POSTPAID_CATALOG_SYNC_ENABLED` (bawaan mati) untuk sinkronisasi katalog pascabayar,
  terpisah dari `PPOB_PRICE_SYNC_ENABLED` agar menyalakannya tidak mengubah harga prabayar.
- `expiresInSeconds` pada respons cek tagihan.
