# TapGo Driver 1.0.0+9 — Release Notes

Tanggal: 2026-10-05. Menggantikan 1.0.0+8 (+4 sampai +7 tetap tidak boleh dipasang; lihat
`TLS_TRUST_ANCHORS.md`). `versionCode` 9 supaya pemasang berkas menerima pembaruan dari +8.

Dasar: uji HP Owner pada driver +7 menemukan lima cacat. Empat perbaikan tampilan/perilaku dan satu
perbaikan dialog SOS dikerjakan di sini. Isi +8 (trust-anchor pinning) tidak diubah.

## Perbaikan

1. **Status beranda mengikuti server, bukan memori aplikasi.** Backend menambah
   `GET /driver/availability` (auth sama dengan POST, hanya membaca). Saat dibuka/di-refresh tanpa
   perjalanan aktif, kartu mengikuti nilai server: ONLINE tampil Online dan pelacakan lokasi menyala,
   OFFLINE tampil Offline dan pelacakan berhenti, BUSY tanpa perjalanan tampil Online. Aplikasi **tidak**
   memanggil `setAvailability` saat dibuka, jadi `onlineSince` dan verifikasi wajah tidak direset. Dengan
   perjalanan aktif, kartu menampilkan status perjalanan; setelah perjalanan selesai kartu kembali ke hasil
   GET (tidak lagi tertahan "Dalam Perjalanan"). Terhadap backend lama (tanpa endpoint, 404) status klien
   dipertahankan; setelah selesai/batal dipakai fallback Online/Offline.
2. **Peta beranda langsung ke posisi driver.** Satu posisi diambil saat dibuka dan tiap pembaruan
   stream memindahkan kamera (tidak menunggu 10 meter). Tanpa GPS peta tetap di Jakarta tanpa marker.
3. **Sampai di tujuan tidak menyelesaikan perjalanan sendiri.** Tombol tetap "Selesaikan Perjalanan".
4. **Penolakan tawaran memberi tahu penumpang** (sisi backend + user_app 2.0.5+35): bila driver menolak
   dan order masih SEARCHING_DRIVER, penumpang menerima push "Masih mencari driver — Seorang driver tidak
   mengambil pesanan. Pencarian dilanjutkan." Tidak dikirim bila driver lain sudah menerima, dan hanya
   sekali per driver per order. Status order tidak berubah.
5. **Dialog SOS:** satu judul, tiga tombol selebar dialog ditumpuk (Batal, WhatsApp CS, Kirim SOS merah
   tanpa ikon huruf "SOS"). Perilaku tidak berubah.
6. **Ikon Play Store dan launcher driver:** lambang singa-T yang sudah ada diperbesar di dalam zona aman
   adaptif (66/108 dp), tulisan TAPGO dan DRIVER dihapus, tersisa satu kendaraan. Latar tetap `#FFC857`.
   Metode: seni asli diekstrak (alpha dari kanal merah, komponen terhubung), tidak digambar ulang.
   Berkas: `google-play-assets/driver/tapgo-driver-icon-512(.png|-flat.png)` dan
   `mipmap-*/ic_launcher_foreground.png`. Ikon penumpang, `ic_launcher.png` legacy, dan feature graphic
   tidak diubah.

## Ketergantungan backend

Perbaikan 1 dan 4 memerlukan backend dengan `GET /driver/availability` dan push `ride_search_continues`.
Backend produksi belum memuatnya sampai Owner merilisnya; sebelum itu driver +9 tetap berfungsi
(fallback di atas) tetapi status beranda belum mengikuti server dan penumpang belum menerima push.
Rilis backend produksi tidak dilakukan di sini.

## Yang belum dilakukan

Belum ada uji HP untuk 1.0.0+9; perilaku di perangkat Android nyata belum dibuktikan. SOS,
`safety-status`, dan `face-check/recheck-attempt` belum ada di backend produksi. Dokumen ini tidak
menyatakan driver_app siap 100%.
