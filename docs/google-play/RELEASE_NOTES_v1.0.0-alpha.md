# Release Notes - TapGo v1.0.0-alpha

Versi: `1.0.0-alpha+1`  
Package: `id.tapgolion.tapgo`

## Ringkasan

Rilis alpha TapGo untuk kesiapan Google Play internal/closed testing.

## Perubahan Utama

- Stabilitas startup aplikasi dan session bootstrap.
- Konfigurasi Android release signing fail-closed.
- Permission audit dan Data Safety mapping.
- Account deletion route publik `https://tapgolion.id/hapus-akun`.
- Pengamanan debug logging agar respons sensitif tidak tampil pada production build.

## Catatan Testing

- Payment gateway utama: DOKU.
- Midtrans tetap secondary/fallback.
- Xendit tidak digunakan pada TapGo v1.0.
- Jangan melakukan transaksi real tanpa skenario UAT yang disetujui.

