# TapGo Driver 1.0.0+15 — perbaikan hasil audit +14

Tanggal: 2026-10-06. Menggantikan 1.0.0+14 (isi +14 tetap berlaku). `versionCode` 15. Pin tetap trust-anchor.
Audit mandiri atas +14 (Owner meminta pemeriksaan ulang); temuan nyata saja:

1. **Bunyi berderik (klik) di awal/akhir** — terukur: ketiga berkas suara (`tapgo_alert`, `_lonceng`, `_panggilan`)
   dimulai pada amplitudo tinggi (12.000-26.000 dari 32.768 dalam 4 ms pertama) dan `panggilan` berakhir pada
   amplitudo 10.586: potongan tajam terdengar sebagai klik. Perbaikan: fade-in 4 ms dan fade-out 30 ms; karakter
   nada, durasi, dan puncak (0,90) tidak berubah.
2. **Ujung surai logo terpotong pada ikon bundar** — terukur: 256 piksel lambang di luar lingkaran terlihat 36 dp
   (tepi pojok atas perisai) pada peluncur berbentuk lingkaran. Perbaikan: lambang foreground adaptif diperkecil 5%
   (lebar 55% kanvas); sisa 12 piksel di luar lingkaran. Ikon legacy dan Play 512 tidak berubah.
3. **Logout cepat setelah login dapat meninggalkan token push** — sejak +14 pendaftaran token tidak lagi ditunggu
   `start()` (menunggu pilihan bunyi terbaca); bila `stop()` datang sebelum pendaftaran selesai, token tidak dicabut
   dan push akun lama tetap sampai ke HP. Perbaikan: token dicatat sebelum menunggu. Tes `push_controller_test.dart`
   (mutasi ke perilaku lama gagal).

## Belum terbukti
Semua poin 1-2 diukur dari berkas, bukan didengar/dilihat di HP. Uji HP +14 yang sama berlaku untuk +15.
