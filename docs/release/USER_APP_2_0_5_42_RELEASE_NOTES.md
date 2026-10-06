# TapGo user_app 2.0.5+42 — ikon Tagihan sesuai gaya, label terbaca di tema gelap

Tanggal: 2026-10-06. Dasar: 2.0.5+41 (isi +41 tetap berlaku). `versionCode` 42. Pin tetap trust-anchor.
Dasar perubahan: tangkapan layar Owner pada grup "Tagihan" di +41.

## Perbaikan
1. **Ikon grup Tagihan tidak mengikuti gaya ikon yang sudah dipakai** — terbukti: sepuluh tile baru tidak punya
   ilustrasi dan jatuh ke ikon Material generik berlatar abu-abu, berbeda dari Pulsa/BPJS/PDAM di grup Digital.
   Kini sepuluh ilustrasi SVG baru bergaya sama (viewBox 96x96, kartu gradien, bayangan elips, kilau, glyph putih)
   dengan warna per kategori yang sama dengan `ppobCategoryColor()`: PLN Pascabayar (kuning-jingga, struk dan
   petir), BPJS TK (hijau, helm proyek), Telkom (merah, gagang telepon), Internet (ungu, router), TV Kabel (merah
   muda), HP Pascabayar (biru, ponsel dan centang), Angsuran (jingga-cokelat, dokumen dan koin), PBB (hijau tosca,
   rumah), Gas (jingga-merah, api), E-Money (indigo, kartu). Tes baru memastikan SETIAP tile Super Menu punya
   ilustrasi yang berkas SVG-nya ada dan tidak ada dua tile berbagi ikon (mutasi: menghapus satu pemetaan gagal).
2. **Label tile Super Menu tidak terbaca di tema gelap** — teks berwarna `#263241` tetap di atas latar navy.
   Kini label tema gelap memakai `#E2E8F0`; tema terang tidak berubah. Berlaku untuk SEMUA tile Super Menu.

## Belum terbukti
Dirender lewat uji widget (terang dan gelap) dan dinilai dari gambar; belum dilihat di layar HP. "PLN Pascabayar"
dan "HP Pascabayar" tampil dengan huruf lebih kecil karena label panjang diskalakan agar muat (perilaku lama).
