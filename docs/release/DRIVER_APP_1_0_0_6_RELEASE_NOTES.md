# TapGo Driver 1.0.0+6 — Release Notes

Rilis ini menggantikan 1.0.0+5. Semua isi 1.0.0+5 (lihat `DRIVER_APP_1_0_0_5_RELEASE_NOTES.md`)
tetap berlaku; hanya satu lubang popup order yang ditutup.

## Mengapa +6 ada

1.0.0+5 sudah terbit dengan popup order masuk, tetapi **tawaran kedua yang datang saat sheet tawaran
lain masih terbuka tidak pernah dibuka**. Urutannya: sheet A terbuka, tawaran B masuk dan tersimpan
di daftar, polling berikutnya tidak lagi menganggap B baru (reference-nya sudah ada di daftar), lalu
menutup A tidak pernah membuka B. Driver baru tahu ada B bila mengetuk daftarnya sendiri.

`versionCode` naik menjadi 6 supaya pemasang berkas menerima pembaruan dari 1.0.0+5 (kode versi yang
sama atau lebih rendah ditolak). Nama versi tetap 1.0.0.

## Isi perbaikan

- Tawaran baru yang tidak sempat dibuka karena sheet lain sedang terbuka, atau karena ada perjalanan
  aktif, kini dicatat sebagai **tertunda**.
- Begitu sheet tertutup — lewat tombol tutup, atau penolakan yang berhasil — tawaran tertunda yang
  masih ada di daftar, masih mencari driver, dan belum ditutup atau ditolak pada sesi ini langsung
  dibuka. Tidak menunggu polling 12 detik berikutnya.
- Bila ada beberapa yang tertunda, dibuka yang paling baru (waktu pembaruan; tanpa waktu, yang
  terakhir di daftar).
- Tawaran yang sudah hilang dari daftar (kedaluwarsa atau diambil driver lain) sebelum sheet sempat
  dibuka tidak dibuka. Tawaran yang ditutup atau ditolak tidak kembali pada sesi ini.
- Sheet yang sedang terbuka tetap tidak diganti, dan perjalanan aktif tetap tidak membuka sheet.
  Bila perjalanan selesai dan tawaran itu masih mencari driver, popup muncul pada refresh berikutnya.

## Yang tidak berubah dari +5

- Pin TLS: pin di +6 cocok dengan sertifikat `api.tapgolion.id` yang diterbitkan 4 Okt 2026 20:08 WIB
  (berlaku sampai 2 Jan 2027). APK +4 dan +5 memuat pin yang tidak cocok dengan sertifikat itu, tidak
  dapat login, dan **tidak boleh dipasang**. Hash di dalam APK adalah sidik kunci publik: bukan rahasia
  dan bukan bukti kunci rahasia server bocor. Apakah pin tetap cocok pada perpanjangan sertifikat
  berikutnya bergantung pada konfigurasi certbot di VPS — langkah Owner di `DEPLOY_VPS.md` bagian 14.1;
  rilis ini tidak mengubahnya dan tidak mengklaim statusnya.
- Tiga endpoint SOS / `safety-status` / `face-check/recheck-attempt` belum ada di backend produksi.
- Verifikasi wajah tetap nonaktif di server dan komisi tidak disentuh.

## Yang belum dilakukan

Belum ada uji HP untuk 1.0.0+6. Dokumen ini tidak menyatakan driver_app siap 100%.
