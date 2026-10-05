# TapGo Driver 1.0.0+11 — Release Notes

Tanggal: 2026-10-06. Menggantikan 1.0.0+10 (isi +10 tetap berlaku). `versionCode` 11.

## Akar masalah "tidak ada bunyi" (dibuktikan dari kode, bukan volume HP)

Channel notifikasi `tapgo_default` sudah dibuat di HP oleh APK lama dengan paket yang sama. Sejak
Android 8, suara dan prioritas channel yang sudah ada **tidak berubah oleh pemasangan baru**, dan
`createNotificationChannel` ulang pada id yang sama diabaikan. Di +10, `_soundOfferOpened` hanya memanggil
`showForegroundAlert`, yang menaruh notifikasi ke channel terkunci itu; kegagalan `show()` ditelan
`catch` tanpa jejak di APK rilis. Payload FCM produksi juga masih memakai `tapgo_default`.

## Perbaikan

- **Channel baru `tapgo_alerts_v2`**, nama terlihat "Peringatan TapGo", dibuat di `MainActivity.onCreate`
  sebelum notifikasi apa pun: `IMPORTANCE_HIGH`, getar hidup, suara eksplisit
  `RingtoneManager.getDefaultUri(TYPE_NOTIFICATION)` dengan `AudioAttributes.USAGE_NOTIFICATION`; tidak ada
  `setSound(null)`. `default_notification_channel_id` di manifest ikut `tapgo_alerts_v2`. `tapgo_default`
  tidak dipakai lagi untuk order, chat, atau pembaruan perjalanan.
- **Notifikasi lokal** (`flutter_local_notifications`) memakai channel yang sama, `Importance.high`,
  `playSound: true`; tanpa `sound: null` dan tanpa `silent: true`. Kegagalan sekarang dicatat (jenis galat
  saja), tidak lagi ditelan diam-diam.
- **Aplikasi di depan: ringtone, bukan notifikasi.** MethodChannel `tapgo.driver/alerts` memutar ringtone
  notifikasi bawaan lewat `RingtoneManager` pada context aplikasi (bunyi tidak bergantung pada channel).
  Satu peristiwa = satu bunyi: di depan hanya ringtone (notifikasi lokal tidak ikut berbunyi); ringtone
  yang gagal jatuh ke SATU notifikasi di channel baru; di belakang yang berbunyi notifikasi FCM di channel
  `tapgo_alerts_v2`.
- **Order**: ringtone diputar saat lembar tawaran benar-benar terbuka (termasuk dari polling), sekali per
  referensi (penjaga sekali-bunyi yang ada tetap dipakai; push + lembar = satu bunyi).
- **Chat**: layar chat perjalanan itu terbuka = tanpa bunyi dan tanpa popup; tidak terbuka = popup (tetap)
  + satu bunyi. Isi pesan tidak pernah masuk notifikasi sistem.
- **"TapGo Driver aktif"** (layanan lokasi) tetap di channel-nya sendiri dan tidak berbunyi berulang.
- Tidak ada izin baru (`RECORD_AUDIO`, `USE_FULL_SCREEN_INTENT` tidak ada; Jangan Ganggu tidak
  dilewati). HP yang mode senyap memang tetap senyap.

Tes: `apps/driver_app/test/alert_channel_test.dart` (14: rincian channel, satu-bunyi, MethodChannel, dan
pemeriksaan berkas Kotlin/manifest) dan grup "uji HP 5 Okt 2026" di `widget_test.dart` (19, termasuk
ringtone dua kali untuk referensi sama, chat terbuka ikut berbunyi, notifikasi masih ber-`tapgo_default`).
Tiap perilaku dibuktikan dengan mutasi.

## Pemasangan

APK +11 menimpa +10 (tanda tangan sama). Channel baru dibuat saat aplikasi dibuka pertama kali; channel lama
tidak dihapus. **Bunyi saat aplikasi terbuka sudah berlaku dengan APK ini saja.** Bunyi notifikasi
LATAR BELAKANG (FCM) baru berlaku setelah backend `release/driver-rating` dengan `channel_id` baru dirilis;
sebelum itu FCM produksi masih menunjuk `tapgo_default` yang terkunci senyap di HP lama.

## Catatan uji HP (belum dilakukan)

- [ ] Order masuk saat aplikasi driver **terbuka**: berbunyi **sekali** (ringtone), lembar tawaran terbuka.
- [ ] Pesan chat penumpang saat layar chat **tidak** terbuka: popup + berbunyi sekali.
- [ ] Pesan chat saat layar chat **terbuka**: tidak berbunyi, tidak ada popup.
- [ ] Notifikasi "TapGo Driver aktif" tidak ikut berbunyi.
- [ ] Pengaturan Android → Aplikasi → TapGo Driver → Notifikasi: ada kategori "Peringatan TapGo" (Penting,
      suara menyala). HP mode senyap tetap senyap.
- [ ] Setelah backend dirilis: aplikasi di latar belakang, order masuk → notifikasi berbunyi (channel baru).

## Yang belum dilakukan

Belum ada uji HP; perilaku di perangkat Android nyata belum dibuktikan. Tidak menyalakan
`DRIVER_FACE_CHECK_ENABLED`, `DRIVER_COMMISSION_ENABLED`, atau `REALTIME_ENABLED`; tidak membawa
SOS/safety-status/face-check; pin tetap trust-anchor.
