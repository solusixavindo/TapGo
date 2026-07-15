# Account Deletion Compliance - TapGo

Tanggal: 15 Juli 2026

## Status

TapGo menyediakan jalur pengajuan penghapusan akun melalui:

- In-app: `Akun` -> `Hapus Akun`
- Web publik: `https://tapgolion.id/delete-account`
- Alias Bahasa Indonesia: `https://tapgolion.id/hapus-akun`
- Support: `support@tapgolion.id`

## In-App Flow

1. User membuka menu akun.
2. User memilih `Hapus Akun`.
3. Aplikasi menampilkan konsekuensi penghapusan.
4. User mengisi alasan opsional.
5. Aplikasi mengirim permintaan ke backend melalui endpoint pengajuan hapus akun.
6. Permintaan ditinjau agar data transaksi/legal yang wajib disimpan tidak terhapus sembarangan.

## Backend Handling

TapGo tidak langsung menghapus ledger, invoice, payment, wallet transaction, withdrawal, atau audit record yang wajib disimpan untuk kepatuhan, audit, perpajakan, penyelesaian sengketa, dan pencegahan fraud.

Data pribadi yang dapat dihapus/dianonimkan setelah verifikasi:

- Nama profil
- Nomor HP/email jika tidak wajib dipertahankan
- Alamat/profil non-transaksional
- Foto dokumen yang tidak wajib dipertahankan
- Data referral non-esensial jika memungkinkan

Data yang dapat dipertahankan:

- Invoice dan status pembayaran
- Ledger wallet/withdrawal
- Data transaksi membership
- Audit log
- Catatan security/fraud
- Data yang diwajibkan regulasi atau kepentingan sah operasional

## Web Page

Halaman `apps/landing-page/src/app/delete-account/page.tsx` sudah tersedia. Route alias `apps/landing-page/src/app/hapus-akun/page.tsx` ditambahkan agar URL Bahasa Indonesia dapat dipakai untuk Play Console.

## Play Console Answer

Gunakan URL: `https://tapgolion.id/hapus-akun`  
Alternatif: `https://tapgolion.id/delete-account`

Estimasi proses: 7-14 hari kerja setelah verifikasi.

