# TapGo user_app 2.0.5+37 — bunyi lewat channel baru dan ringtone

Tanggal: 2026-10-06. Dasar: 2.0.5+36 (isi +36 tetap berlaku). `versionCode` 37. Pin tetap trust-anchor.

## Akar masalah "tidak ada bunyi"

Channel `tapgo_default` sudah dibuat di HP oleh APK lama dengan paket yang sama; sejak Android 8 suara dan
prioritas channel yang sudah ada tidak berubah oleh pemasangan baru, dan membuat ulang channel pada id yang
sama diabaikan. Notifikasi lokal +36 masuk ke channel terkunci itu (dan kegagalannya ditelan tanpa jejak).

## Perbaikan

- **Channel baru `tapgo_alerts_v2`** ("Peringatan TapGo"): dibuat di `MainActivity.onCreate`,
  `IMPORTANCE_HIGH`, getar hidup, suara eksplisit ringtone notifikasi bawaan
  (`USAGE_NOTIFICATION`), tanpa `setSound(null)`. Manifest `default_notification_channel_id` ikut channel
  ini; `tapgo_default` tidak dipakai lagi.
- **Notifikasi lokal** di channel yang sama, `Importance.high`, `playSound: true`, tanpa `sound: null`/
  `silent: true`; kegagalan tercatat (jenis galat saja).
- **Aplikasi di depan: ringtone bawaan lewat MethodChannel `tapgo.user/alerts`** (`RingtoneManager`), bukan
  notifikasi. Satu peristiwa = satu bunyi: di depan hanya ringtone; ringtone gagal → satu notifikasi di
  channel baru; di belakang notifikasi FCM di channel `tapgo_alerts_v2`.
- **Chat**: layar chat perjalanan itu terbuka = tanpa bunyi dan tanpa popup; tidak terbuka = popup (tetap)
  + satu bunyi. Isi pesan tidak masuk notifikasi sistem.
- Izin: tidak ada `RECORD_AUDIO`/`USE_FULL_SCREEN_INTENT`; Jangan Ganggu tidak dilewati.

Tes: `apps/user_app/test/alert_channel_test.dart` (15; mutasi dibuktikan untuk channel lama, chat terbuka
ikut berbunyi, dan ringtone + notifikasi sekaligus).

## Bergantung pada backend (rilis terpisah, bukan dibuktikan APK ini)

- Bunyi notifikasi **latar belakang** (FCM) memakai `channel_id` dari backend. Sampai backend
  `release/driver-rating` (dengan `tapgo_alerts_v2`) dirilis, FCM produksi masih menunjuk `tapgo_default`.
- Uji bintang penilaian dan banner penolakan sah **hanya setelah** backend `release/driver-rating` dirilis
  (cutover VPS). Aplikasi +36/+37 sudah memanggil `POST /api/v1/rides/{referensi}/rating`; route itu tidak
  ada di proses produksi `tapgo-5588076`, sehingga formulir menampilkan "Penilaian belum tersedia di versi
  layanan saat ini." Itu bukan cacat aplikasi.

## Catatan uji HP (belum dilakukan)

- [ ] Aplikasi penumpang terbuka, status perjalanan berubah (driver menerima): berbunyi **sekali**.
- [ ] Pesan chat driver saat layar chat tidak terbuka: popup + berbunyi sekali; saat terbuka: senyap.
- [ ] Pengaturan Android → Aplikasi → TapGo → Notifikasi: ada "Peringatan TapGo" (Penting, suara menyala).
- [ ] Setelah backend dirilis: aplikasi di latar belakang, status berubah → notifikasi berbunyi.
- [ ] Setelah backend dirilis: beri bintang sekali; kirim ulang ditolak dan layar menampilkan bintang
      tersimpan; tolak tawaran dari driver → banner jelas.

## Yang belum dilakukan

Belum ada uji HP. Dokumen ini tidak menyatakan aplikasi siap produksi.
