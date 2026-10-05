# TapGo user_app 2.0.5+36 — bunyi, popup chat, pencarian terdekat, tempat cepat, penilaian

Tanggal: 2026-10-06. Dasar: 2.0.5+35 (trust-anchor pinning tidak diubah). `versionCode` 36.
2.0.5+33 tetap tidak boleh dipasang atau diunggah.

## Yang LANGSUNG terbukti dari APK ini (tidak butuh rilis backend baru)

1. **Push saat aplikasi terbuka ikut berbunyi** lewat notifikasi lokal pada channel `tapgo_default` yang
   sama dengan notifikasi latar (pola `flutter_local_notifications` driver; dependensi baru
   `flutter_local_notifications` ^18.0.1 dan desugaring Gradle). Sebelumnya hanya SnackBar (tidak bersuara).
2. **Popup saat pesan chat driver masuk** bila layar chat perjalanan itu tidak terbuka (tombol **Buka
   chat**, plus bunyi). Bila layar chat itu terbuka: hanya masuk ke daftar, tanpa popup/bunyi tambahan.
   Popup dan notifikasi tidak memuat isi pesan.
3. **Pencarian "Titik jemput" dan "Tujuan" memprioritaskan yang terdekat dari HP.** Pusat cari selalu posisi
   HP (terakhir diketahui, atau pembacaan saat ini); tidak pernah Jakarta atau titik jemput. Kotak ketat
   ~3 km dulu, dilebarkan bertahap ke ~15 km lalu kotak terluas bila hasil < 3; `countrycodes=id`, User-Agent
   yang ada, jeda ≥ 1,1 detik antar permintaan Nominatim; setiap hasil diurutkan menurut jarak haversine,
   yang terdekat di atas. Tanpa posisi HP: pesan "Lokasi perangkat belum tersedia…", tidak mencari di
   Jakarta. Tanpa kunci Google Places.
4. **Tempat cepat bisa dihapus**: tekan lama Rumah/Kantor → konfirmasi → dihapus (riwayat perjalanan tidak
   ikut). Tekan lama chip riwayat → disembunyikan lewat catatan lokal (perjalanan di server tidak dihapus);
   chip yang lebih lama mengisi kekosongan. Catatan tersembunyi ikut dibersihkan saat keluar akun.
5. **Langkah penilaian saat perjalanan selesai (tampilan)**: bintang 1–5, catatan opsional ≤ 280
   karakter, **Kirim Penilaian** sebelum "Kembali ke Dashboard"; kirim tidak ganda (single-flight); bila
   sudah dinilai hanya bintangnya yang tampil; tidak ada bintang di kartu driver selama perjalanan berjalan.
6. **Pemberitahuan penolakan driver lebih jelas (tampilan)**: kartu mencari driver menampilkan banner
   "Seorang driver tidak mengambil pesanan. Pencarian dilanjutkan." (atau "N driver…") dan status tetap
   "Mencari driver". Push `ride_search_continues` yang diterima di depan **atau yang notifikasinya dibuka**
   mengisi catatan yang sama, supaya layar tidak menunggu poll berikutnya.

Tes: `apps/user_app/test/uji_hp_5okt_test.dart` (42 tes; mutasi dibuktikan untuk urutan jarak, popup chat,
riwayat tersembunyi, dan banner penolakan).

## Yang butuh rilis backend TERPISAH — uji HP butir ini BELUM SAH sebelum backend itu dirilis

Perubahan backend ada di repo (commit terpisah) tetapi **tidak di-deploy** dan **APK ini tidak
membuktikannya**:

- **Sinyal penolakan pada detail order**: `GET /rides/:reference` memuat `searchRejectionCount` (hitungan
  driver yang menolak selama order mencari driver; tanpa nama/id driver). Tanpa backend ini banner di butir 6
  hanya mengandalkan push `ride_search_continues` (sudah ada di produksi lewat rilis minimal availability),
  jadi uji "tolak tawaran → layar penumpang berubah jelas" **belum sah**.
- **Penilaian**: `POST /rides/:reference/rating`, tabel baru `ride_ratings` (migrasi
  `20261005120000_ride_ratings`), dan `rating` pada detail order selesai. **APK +36 belum dapat
  menyelesaikan kirim bintang ke produksi**: sampai backend itu dirilis, tombol Kirim menampilkan "Penilaian
  belum tersedia di versi layanan saat ini. Coba lagi nanti." (formulir tetap, tidak crash).
- `sound: "default"` pada payload FCM latar (`FcmClient.ts`).

## Yang tidak diubah

Tidak ada kunci Google Places; pin tetap trust-anchor; fitur lain tidak diubah.

## Catatan uji HP (belum dilakukan)

- [ ] Ketik "alfamart" di **Titik jemput** dan di **Tujuan**: hasil teratas yang terdekat dari HP (periksa
      urutan jaraknya; matikan GPS untuk melihat pesan lokasi belum tersedia).
- [ ] Tempat cepat: tekan lama Rumah/Kantor → konfirmasi → hilang; tekan lama chip riwayat → tersembunyi.
- [ ] Chat driver masuk saat layar chat tidak terbuka: popup + bunyi; Buka chat membuka chat. Saat layar chat
      terbuka: tanpa popup.
- [ ] Push saat aplikasi terbuka berbunyi (mis. status perjalanan berubah).
- **Setelah backend penilaian dan sinyal penolakan dirilis terpisah**, baru uji: (a) tolak tawaran dari driver
  → banner jelas di layar penumpang tanpa menunggu push; (b) selesaikan perjalanan → beri bintang sekali;
  kirim ulang tidak membuat penilaian kedua dan layar menampilkan bintang yang tersimpan.

## Yang belum dilakukan

Belum ada uji HP untuk build ini. Dokumen ini tidak menyatakan aplikasi siap produksi.
