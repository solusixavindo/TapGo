# TapGo 2.0.5+47 — pengumuman di ikon bel

Tanggal: 2026-11-15. Menggantikan 2.0.5+46 (isi +46, termasuk tambahan 14 Nov, tetap berlaku). `versionCode` 47. Pin tetap trust-anchor.
Paket dinyatakan lengkap oleh Owner pada 15 Nov 2026.

## Yang baru
1. **Ikon bel membuka layar Pengumuman.** Sebelumnya bel adalah tombol mati ("Notifikasi belum dapat dibuka saat ini"). Kini:
   daftar pengumuman pemilik TapGo (hanya Super Admin VIP yang menulis), terbaru di atas, dengan penanda "Baru"; titik merah di
   bel dan jumlahnya di keterangan bila ada yang belum dibuka; membuka layar menandai semuanya sudah dibuka
   (`POST /announcements/seen`); penyegaran tiap 60 detik hanya selagi aplikasi di depan dan segera saat kembali ke aplikasi.
   Layar kosong dan gagal dimuat (dengan tombol "Muat Ulang") ditangani; kegagalan tidak merusak bel atau beranda.
2. **Isi pengumuman selalu teks polos.** Server menolak tautan, alamat situs, dan alamat surel; aplikasi menampilkannya sebagai teks
   biasa (bukan SelectableText) tanpa tautan yang dapat diketuk (dijaga tes).

Berpasangan dengan backend `tapgo-5f60844` atau lebih baru (rute `/announcements`, migrasi `20261115200000_announcements`); keduanya
sudah aktif di produksi sejak 15 Nov 2026. Tanpa backend itu bel menampilkan "Pengumuman belum dapat dimuat".

## Tidak ada di versi ini
Notifikasi push untuk pengumuman (tahap 2, belum dikerjakan): pengumuman hanya terlihat saat aplikasi dibuka. HP tanpa layanan Google
tidak menerima push apa pun, termasuk notifikasi lain.

## Sudah teruji Owner di HP (15 Nov 2026, APK uji bernomor +46)
Pengumuman tampil di bel; ganti foto profil di web dan APK. Belum diuji Owner pada nomor +47 itu sendiri.
Hal yang belum terbukti dari +46 (kecepatan masuk beranda) tetap berlaku.
