# TapGo user_app 2.0.5+43 — menu Notifikasi dengan tiga pilihan bunyi

Tanggal: 2026-10-06. Dasar: 2.0.5+42 (isi +42 tetap berlaku). `versionCode` 43. Pin tetap trust-anchor.
Dasar perubahan: permintaan Owner setelah uji HP +42 — ikon menu "Uji bunyi" tidak konsisten dengan ikon menu Akun
lain, dan perlakuannya harus sama dengan menu Notifikasi di aplikasi driver (pilihan tiga bunyi).

## Perubahan
1. **"Uji bunyi" diganti "Notifikasi"** di menu Akun (keterangan: "Bunyi: TapGo"). Layar diagnostik lama dihapus
   (`sound_diagnostics.dart`, pemeriksaan keadaan HP, `soundDiagnostics` native).
2. **Tiga pilihan bunyi seperti aplikasi driver**: TapGo (bawaan), Lonceng, Panggilan. Mengetuk satu pilihan memilihnya
   sekaligus membunyikannya; pilihan tersimpan dan berlaku langsung saat aplikasi terbuka (bunyi diputar dari berkas
   suara aplikasi, satu bunyi per peristiwa).
3. **Pilihan dikirim ke server** pada pendaftaran token push (`sound`) dan didaftarkan ulang saat berganti, sehingga
   notifikasi saat aplikasi TERTUTUP memakai channel bunyi yang sama (`tapgo_alerts_v3`, `_lonceng`, `_panggilan`).
   Backend sudah mendukungnya (migrasi `push_tokens.sound`, daftar putih tiga bunyi, cutover 6 Okt 2026).
4. **Ikon baru** `assets/icons/basic_portal/notifications.png` (1024 px, RGBA): lonceng biru mengilap dengan lencana
   emas bernada, bergaya sama dengan stiker menu Akun lain (profil, ubah password, bantuan, keluar).
5. Bila notifikasi dimatikan di pengaturan Android, layar Notifikasi menampilkan peringatan dengan tombol
   "Nyalakan Notifikasi" (hanya muncul dalam keadaan itu; selain itu layar sama dengan driver: tiga pilihan).
6. Native: `AlertSound.kt` membuat tiga channel dan memutar bunyi menurut argumen `sound`; dua berkas suara baru
   (`tapgo_alert_lonceng.wav`, `tapgo_alert_panggilan.wav`, sama dengan driver) masuk `keep.xml`. Berkas `tapgo_alert.wav`
   user_app tidak diubah.

## Uji
`test/notification_settings_test.dart` (layar, tiga pilihan, ketuk = bunyi + pilih + simpan, pemulihan, kunci rusak, notifikasi
mati, tema terang dan gelap, pendaftaran token membawa bunyi dan didaftarkan ulang, ikon, kode lama dihapus), `alert_channel_test.dart`
(kunci/id channel Kotlin sama dengan Dart, tiga berkas suara dan keep.xml, argumen `sound`), `widget_test.dart` (stiker
Notifikasi 1024 px RGBA). Mutasi dibuktikan: token tanpa `sound`, pratinjau bunyi dihapus, pilihan tidak disimpan — masing-masing
membuat uji gagal.

## Belum terbukti
Belum didengar di HP: bunyi Lonceng dan Panggilan, channel baru di pengaturan Android, dan notifikasi saat aplikasi tertutup
setelah memilih bunyi lain (butuh pengiriman push nyata dari server). Ikon dirender dan dibandingkan berdampingan dengan stiker lain,
belum dilihat di layar HP.
