# TapGo Driver 1.0.0+7 — Release Notes

Rilis ini menggantikan 1.0.0+6. Isi 1.0.0+5 dan 1.0.0+6 tetap berlaku
(`DRIVER_APP_1_0_0_5_RELEASE_NOTES.md`, `DRIVER_APP_1_0_0_6_RELEASE_NOTES.md`); hanya antrian popup
order yang disempurnakan.

## Mengapa +7 ada

Di 1.0.0+6, bila beberapa tawaran `searchingDriver` datang dalam satu refresh saat tidak ada sheet dan
tidak ada perjalanan aktif, hanya yang terbaru dibuka. Yang lain tidak dicatat sebagai tertunda,
polling berikutnya menganggap reference itu sudah ada di daftar, dan menutup sheet tidak pernah
membuka mereka.

`versionCode` naik menjadi 7 supaya pemasang berkas menerima pembaruan dari 1.0.0+6 (kode versi yang
sama atau lebih rendah ditolak). Nama versi tetap 1.0.0.

## Isi perbaikan

Setiap tawaran `searchingDriver` yang belum dibuka, ditutup, atau ditolak pada sesi ini akhirnya
membuka `OfferDetailSheet` yang sudah ada, satu per satu, yang terbaru lebih dulu (waktu pembaruan;
tanpa waktu, yang terakhir di daftar):

- Semua kandidat yang tidak sedang dibuka dicatat tertunda sebelum fungsi kembali, termasuk saat
  beberapa tawaran datang bersamaan dan yang terbaru langsung dibuka.
- Menutup sheet, atau menolak tawaran dengan berhasil, langsung membuka tawaran tertunda berikutnya
  tanpa menunggu polling 12 detik.
- Tawaran yang sedang terbuka tetapi sudah hilang dari daftar, atau statusnya bukan
  `searchingDriver`, dianggap sudah dilihat: sheetnya ditutup dan tawaran tertunda berikutnya dibuka
  pada refresh yang sama.
- Bila sebuah tawaran dipilih manual sementara tawaran lain terbuka, tawaran yang lama dianggap
  sudah dilihat dan tidak kembali.
- Tawaran yang hilang dari daftar, ditutup, atau ditolak tidak dibuka. Logout mengosongkan catatan.
- Sheet yang sedang terbuka tetap tidak diganti. Perjalanan aktif tetap tidak membuka sheet; setelah
  perjalanan selesai, refresh berikutnya mengantrikan semua tawaran yang masih mencari driver dengan
  pola yang sama.

## Fakta pin dan sertifikat

- Pin di +7 cocok dengan sertifikat `api.tapgolion.id` yang diterbitkan 4 Okt 2026 20:08 WIB
  (berlaku sampai 2 Jan 2027). APK +4 dan +5 memuat pin yang tidak cocok, tidak dapat login, dan
  tidak boleh dipasang.
- Hash di dalam APK adalah sidik kunci publik, bukan rahasia.
- Pin tetap cocok pada perpanjangan sertifikat berikutnya hanya bila kunci server dipertahankan. Itu
  bergantung pada konfigurasi certbot di VPS — langkah Owner di `DEPLOY_VPS.md` bagian 14.1 — dan
  berada di luar cakupan rilis ini; catatan ini tidak mengklaim statusnya.

## Yang belum dilakukan

Belum ada uji HP untuk 1.0.0+7. Tiga endpoint SOS / `safety-status` / `face-check/recheck-attempt`
belum ada di backend produksi. Verifikasi wajah tetap nonaktif di server dan komisi tidak disentuh.
Dokumen ini tidak menyatakan driver_app siap 100%.
