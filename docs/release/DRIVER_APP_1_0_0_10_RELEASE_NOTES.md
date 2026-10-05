# TapGo Driver 1.0.0+10 — Release Notes

Tanggal: 2026-10-06. Menggantikan 1.0.0+9 (isi +9 tetap berlaku). `versionCode` 10.
Dasar: temuan uji HP Owner pada driver +9 dan user_app +35 (5 Okt 2026).

## Yang LANGSUNG terbukti dari APK ini (tidak butuh rilis backend baru)

1. **Order masuk berbunyi saat lembar tawaran benar-benar terbuka**, termasuk order yang datang dari
   polling (sebelumnya diam: suara hanya mungkin dari push FCM latar depan). Notifikasi lokal memakai
   channel `tapgo_default` yang sama (IMPORTANCE_HIGH; tidak ada channel baru, tidak ada
   `playSound:false`/`setSound(null)`). Satu tawaran hanya berbunyi sekali walau datang lewat dua jalur
   (push dan lembar). Di latar belakang tidak digandakan (notifikasi FCM yang berbunyi).
2. **Popup saat pesan chat masuk.** Bila layar chat perjalanan itu terbuka, pesan hanya masuk ke daftar
   (tanpa popup, tanpa bunyi tambahan). Bila tidak terbuka: popup di dalam aplikasi ("Pesan baru dari
   penumpang") dengan tombol **Buka chat**, plus bunyi lewat notifikasi lokal. Notifikasi sistem dan popup
   **tidak memuat isi pesan** (judul peran pengirim, isi generik; sama seperti sebelumnya). Notifikasi chat
   yang diketuk membuka chat-nya. Popup tidak menumpuk untuk pesan beruntun.
3. **Pesan chat diambil lewat REST tiap 4 detik selama layar chat terbuka**, digabung tanpa duplikat (pola
   `_poll` user_app). Socket.IO tidak dihidupkan (`REALTIME_ENABLED` tetap off); percobaan sambung ulang
   socket dibatasi 3 kali.
4. **Pesan cepat di chat driver**: "Saya menuju titik jemput", "Saya sudah sampai", "Mohon tunggu
   sebentar", "Baik, saya mengerti" (kalimat sisi driver, bukan salinan penumpang), dikirim lewat jalur
   kirim yang sama.
5. **Badge "Live"/"Offline" dihapus dari chat driver** (itu status socket, bukan ketersediaan driver, dan
   selalu "Offline" karena realtime mati). Tidak diganti kata apa pun; membuka chat tidak mengubah
   ketersediaan driver.

Tes: `apps/driver_app/test/widget_test.dart` grup "uji HP 5 Okt 2026" (15 tes; tiap perilaku utama
dibuktikan dengan mutasi: tanpa bunyi lembar, tanpa dedupe bunyi, popup walau chat terbuka, pesan ganda).

## Yang butuh rilis backend TERPISAH (bukan bagian APK ini)

- `sound: "default"` pada payload Android FCM (`FcmClient.ts`) untuk notifikasi **latar belakang**.
  Backend produksi belum memuatnya; tanpa itu bunyi latar bergantung pada pengaturan channel di HP.
- Popup chat bergantung pada push FCM `chat_message` yang sudah dikirim backend (tidak diubah di sini).

## Yang TIDAK diubah / tidak dikerjakan

Tidak menyalakan `DRIVER_FACE_CHECK_ENABLED`, `DRIVER_COMMISSION_ENABLED`, atau `REALTIME_ENABLED`; tidak
memasukkan SOS/safety-status/face-check; pin TLS tetap trust-anchor; tidak ada perubahan debit dompet,
HMAC webhook, atau tarik dana web.

## Catatan uji HP (belum dilakukan; belum ada uji HP untuk +10)

Satu HP driver (+10), satu HP penumpang (+36 untuk uji popup/bunyi penumpang):

- [ ] Order masuk berbunyi **meski aplikasi sedang terbuka** (lembar tawaran terbuka sendiri dari polling).
      Satu bunyi per order, bukan dua.
- [ ] Penumpang mengirim pesan saat layar chat driver **tidak** terbuka: muncul popup + bunyi; Buka chat
      membuka chat perjalanan itu; popup/notifikasi tidak menampilkan isi pesan.
- [ ] Penumpang mengirim pesan saat layar chat **terbuka**: pesan muncul dalam ≤ 4 detik, tanpa popup,
      tanpa bunyi tambahan, tanpa duplikat.
- [ ] Di dalam chat ada empat chip pesan cepat sisi driver; mengetuk satu mengirimnya.
- [ ] Selama mengobrol **tidak ada label "Offline"/"Live"**, dan status Online driver tidak berubah.
- [ ] Mode gelap/terang: popup dan chip terbaca. Teks besar: chip tidak merusak tata letak.

## Yang belum dilakukan

Belum ada uji HP; perilaku di perangkat Android nyata (bunyi sebenarnya, heads-up notification, izin
notifikasi) belum dibuktikan. Dokumen ini tidak menyatakan driver_app siap 100%.
