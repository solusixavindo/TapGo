# TapGo 2.0.5+48 — splash tanpa halaman putih + ucapan selamat datang

Tanggal: 2026-11-16. Menggantikan 2.0.5+47 (isi +47, termasuk pengumuman di bel, tetap berlaku). `versionCode` 48. Pin tetap trust-anchor.
Permintaan Owner 16 Nov 2026 (catatan uji +47 di HP).

## Yang diperbaiki
1. **Halaman putih dengan lingkaran berputar sebelum splash (pembukaan pertama).** Akar masalah (terbukti di kode dan di emulator
   dengan pemasangan bersih): tiga lapis berurutan, tidak satu pun bermerek TapGo.
   (a) jendela peluncuran Android berwarna **putih** (tema peluncuran bawaan);
   (b) `main()` menunggu pekerjaan awal pembukaan pertama (reset cache sekali per instalasi, sampai 3 dtk) SEBELUM `runApp`, jadi
   Flutter belum menggambar apa pun dan HP menahan layar putih itu;
   (c) sesudah itu `_SessionBootstrap` menampilkan `Scaffold` putih + `CircularProgressIndicator` selama penyimpanan aman
   (Keystore, paling lambat pada pembukaan pertama) dibaca, dan baru kemudian splash TapGo muncul — jadi waktu tunggu itu
   ditambahkan lagi di depan splash 2,4 dtk.
   Perbaikan: jendela peluncuran Android kini gradien biru tua TapGo (`launch_background` + warna splash Android 12+, terang dan gelap);
   `runApp` langsung jalan, pekerjaan awal berjalan SELAMA splash dan tetap selesai SEBELUM sesi dibaca (urutan dan keamanan tidak
   berubah; kegagalannya dicatat, tidak menggantung); layar pertama Flutter adalah splash bermerek yang sama dengan jam animasi bersama
   (peralihan tanpa lompatan), dan splash ditahan 2,4 dtk dihitung sejak layar pertama (bukan tunggu + 2,4 dtk). Bila HP sangat
   lambat (> 5 dtk) cincin kecil putih muncul di bawah logo supaya pengguna tahu aplikasi masih bekerja.
2. **Ucapan selamat datang untuk pengguna baru.** Pada pemasangan BARU, satu pengumuman lokal "Selamat datang di TapGo!" muncul
   paling atas di bel (titik merah "1"), dibuka dari bel setelah masuk. Teks polos tanpa tautan/alamat/surel (dijaga tes).
   Pengguna lama yang hanya memperbarui aplikasi TIDAK mendapat ucapan (penanda reset cache yang sudah ada dipakai membedakan
   pemasangan baru dari pembaruan). Dicatat sekali; membuka layar Pengumuman menandainya terbaca (dan memanggil
   `POST /announcements/seen` hanya bila ada pengumuman server yang belum dibuka). Ucapan tidak menyentuh server dan tidak memuat data pengguna.

## Teks ucapan
"Selamat datang di TapGo!" — Terima kasih sudah memasang TapGo. Dari satu aplikasi Anda bisa memesan ojek, membayar tagihan dan pulsa,
serta mengisi Saldo TapGo. Untuk memulai: lengkapi profil Anda di menu Akun, lalu coba pesan perjalanan pertama Anda dari Beranda.
Butuh bantuan? Buka Akun > Tiket Bantuan atau tab Chat. Kabar penting dari TapGo akan selalu muncul di sini, di ikon bel.

## Tes
`test/launch_and_welcome_test.dart` (18 tes): splash bermerek bukan spinner putih; cincin lambat hanya setelah 5 dtk; tanpa tunggu ganda
(layar masuk tepat 2,4 dtk dari layar pertama); kegagalan pekerjaan awal tidak menggantung; peralihan mulus; instalasi baru/lama/sekali
catat; teks tanpa tautan; urutan dan hitungan belum-dibaca; layar menandai terbaca. Mutasi (spinner putih dikembalikan, tunggu ganda,
logika instalasi dibalik) menggagalkan 7 dari 18 tes. Suite penuh: 618 lulus, 0 gagal.

## Tidak ada di versi ini
Ucapan tidak dikirim sebagai push dan hanya terlihat setelah masuk (bel ada di Beranda). Tema peluncuran Android 12+ memakai warna
latar splash saja (sistem tidak mengizinkan gradien di sana).
