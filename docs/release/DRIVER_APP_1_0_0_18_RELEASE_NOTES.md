# TapGo Driver 1.0.0+18 — teks saldo minimal Rp10.000

Tanggal: 2026-11-15. Menggantikan 1.0.0+17 (isi +17 tetap berlaku). `versionCode` 18. Pin tetap trust-anchor.
Keputusan pihak TapGo: saldo minimal menerima pesanan tunai Rp50.000 menjadi **Rp10.000**. Aturannya ditegakkan server
(`DRIVER_MIN_CASH_BALANCE=10000` di produksi sejak 15 Nov 2026); versi ini menyelaraskan teks di aplikasi.

## Yang berubah
1. **Pusat Bantuan**: jawaban "Mengapa saya tidak bisa menerima pesanan tunai?" menyebut Rp10.000 (sebelumnya Rp50.000).
2. **Pernyataan Kemitraan bagian 7**: angka yang sama; **versi naskah naik menjadi `2026-11-15.1`** (dicatat di audit pada pengajuan baru
   sebagai bukti naskah mana yang disetujui). Driver yang sudah mendaftar tidak diminta setuju ulang: batas baru lebih longgar dan
   aplikasi tidak punya mekanisme persetujuan ulang.
3. Angka di kedua teks kini satu konstanta (`kDriverMinCashBalanceLabel`) dan dijaga tes. Kartu saldo tab Pendapatan dan pesan
   penolakan tetap membaca angka dari server (sudah menampilkan Rp10.000 di +17).

## Tidak berubah
Notifikasi order saat layar mati diperbaiki di SERVER (proyek Firebase salah di .env), bukan di aplikasi. Teks notifikasi di layar kunci
yang tersembunyi mengikuti pengaturan layar kunci HP (di luar aplikasi).

## Belum terbukti
Perilaku di HP belum diuji Owner pada +18. Tombol Terima dan rincian saldo dari +17 sudah diuji Owner; rincian saldo baru tampil bila
`BONUS_LOCK_ENABLED=true` di server (belum dinyalakan).
