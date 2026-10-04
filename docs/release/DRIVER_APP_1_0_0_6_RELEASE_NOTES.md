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

- Pin leaf TLS dan `reuse_key`: sertifikat server memakai kunci yang dipakai ulang pada tiap
  perpanjangan (`reuse_key = True`, sudah dibuktikan pada 4 Okt 2026), jadi pin tidak putus pada
  perpanjangan berikutnya selama konfigurasi itu tidak diubah. Kunci diganti pada 4 Okt 2026 setelah
  kunci sebelumnya terbuka sebagian; artefak yang dibangun dengan pin kunci lama tidak dapat terhubung
  dan tidak boleh dipakai. Catatan teknis ada di `DEPLOY_VPS.md` bagian 14.1 (langkah Owner di VPS).
- Tiga endpoint SOS / `safety-status` / `face-check/recheck-attempt` belum ada di backend produksi.
- Verifikasi wajah tetap nonaktif di server dan komisi tidak disentuh.

## Yang belum dilakukan

Belum ada uji HP untuk 1.0.0+6. Dokumen ini tidak menyatakan driver_app siap 100%.
