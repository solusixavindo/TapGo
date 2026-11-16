# TapGo Driver 1.0.0+19 — hasil audit 17 Nov 2026 (4 perbaikan)

Tanggal: 2026-11-17. Menggantikan 1.0.0+18 (isi +17 dan +18 tetap berlaku). `versionCode` 19. Pin tetap trust-anchor.
Permintaan Owner: "cek ulang secara mendalam" lalu "kerjakan temuan 1 sampai 4 untuk +19". Tidak ada perubahan server, izin, atau
tampilan menu.

## Yang berubah
1. **Soket chat dihapus (keamanan).** Pinning TLS hanya dipasang di klien HTTP (Dio); soket Socket.IO di layar chat memakai
   kepercayaan sistem dan mengirim access token di jabat tangan. Server produksi mematikan realtime (`REALTIME_ENABLED=false`), jadi soket
   hanya mencoba 3 kali lalu menyerah. Kode soket dan paket `socket_io_client` (beserta `socket_io_common` dan `web_socket`) dihapus;
   pesan chat tetap lewat REST dan polling tiap 4 detik, seperti yang memang dipakai di produksi.
2. **Jendela peluncuran Android biru tua, bukan putih.** Sama seperti user_app +48: kilatan putih sebelum splash TapGo (terutama pada
   pemasangan pertama saat mesin Flutter belum siap) kini gradien yang sama dengan splash (terang, gelap, dan splash sistem Android 12+).
   Hanya resource Android; tidak ada pekerjaan startup yang berubah (`main()` memang tidak menahan layar).
3. **Tombol tidak lagi diam saat jawaban server tak terbaca.** Tolak tawaran, Lanjut perjalanan (jemput/tiba/mulai/selesai), Batalkan
   perjalanan, Online/Offline, dan pemeriksaan sebelum Online kini menampilkan "Permintaan belum dapat dipastikan. Periksa koneksi,
   lalu coba lagi." (kartu dan SnackBar, supaya terlihat walau daftar tergulir). Untuk Lanjut dan Batalkan, ruang kerja dimuat ulang DULU
   (server mungkin sudah memprosesnya) dan pesan hanya tampil bila status perjalanan memang belum berubah. Pola yang sama dengan tombol
   Terima di +17.
4. **Tautan luar yang gagal dibuka diberi tahu.** Satu pembuka tautan (`_openExternalLink`) dipakai semua tombol (WhatsApp CS, Kebijakan
   Privasi, navigasi Google Maps, isi saldo): bila HP tidak punya peramban/WhatsApp atau terjadi galat platform, SnackBar
   "Tidak dapat membuka tautan di HP ini…" tampil, bukan diam.

## Tes
`test/unconfirmed_actions_test.dart` (11 tes): lima tombol di atas dengan galat tak terduga, tiga kasus tautan (gagal, melempar,
berhasil), dan penjaga sumber (tidak ada Socket.IO, satu pemanggil `launchUrl`, resource peluncuran biru). Mutasi (mengembalikan
cacat) menggagalkan 7 tes.

## Belum terbukti
Perilaku di HP belum diuji Owner pada +19. user_app masih memakai Socket.IO untuk chat (sengaja, belum disentuh).
