# TapGo Driver 1.0.0+4 — Release Notes

> **PERINGATAN (4 Okt 2026): artefak ini tidak dapat terhubung ke server produksi** (cacat pinning TLS: callback menerima sertifikat teratas, bukan leaf; lihat `TLS_TRUST_ANCHORS.md`). Jangan dipasang atau diunggah. Pengganti: driver 1.0.0+8.

Rilis ini menggabungkan beberapa batch pekerjaan sejak APK 1.0.0+3 terakhir yang diuji Owner: fitur
baru Tombol SOS, langkah pertama menuju kesiapan Google Play Store (fase E4 dari
`DRIVER_APP_READINESS_PLAN.md`), dan dua fitur keamanan/kesejahteraan baru yang diadaptasi dari
Gojek/Grab (verifikasi wajah ulang acak + pengingat kelelahan). Nomor versi TIDAK dinaikkan lagi
untuk batch terakhir ini atas permintaan Owner — APK/AAB 1.0.0+4 dibangun ULANG dengan kode
tambahan ini, menggantikan build 1.0.0+4 sebelumnya yang belum memuatnya.

## Fitur baru: Tombol SOS darurat

Lihat detail lengkap di `DRIVER_APP_1_0_0_3_RELEASE_NOTES.md` bagian "Fitur baru: Tombol SOS darurat
(30 Sep 2026)" — diimplementasikan di bawah label versi 1.0.0+3 sebelum rilis ini dinaikkan, jadi
catatannya tetap di sana. Ringkasan: tombol SOS di app bar global (terjangkau dari tab mana pun),
dialog konfirmasi dengan lokasi + ride aktif terlampir otomatis, fallback WhatsApp CS. Backend:
`POST /api/v1/driver/sos`, konsol admin `GET`/`PATCH /api/v1/admin/rides/sos`.

**Keterbatasan yang masih berlaku**: TapGo belum punya provider SMS/WhatsApp produksi sama sekali —
pemberitahuan admin saat ini hanya lewat push (tidak menjangkau dashboard web) dan daftar admin yang
harus dibuka manual.

## E4: Gerbang versi minimum driver_app (baru)

Sebelum rilis ini, driver_app **tidak pernah mengirim header identitas aplikasi sama sekali** ke
backend — artinya APK driver lama tidak bisa dipaksa update selamanya, tidak peduli separah apa
bug-nya. Mulai build ini:

- driver_app mengirim `X-TapGo-App: driver`, `X-TapGo-Platform`, `X-TapGo-App-Version`, dan
  `X-TapGo-Distribution: play` di setiap permintaan ke backend.
- Backend punya gerbang versi minimum KHUSUS driver (`DRIVER_MIN_APP_BUILD`,
  `DRIVER_LEGACY_CLIENT_BLOCK_ENABLED`) — terpisah total dari punya user_app, supaya menaikkan satu
  tidak pernah tidak sengaja memblokir aplikasi yang lain.
- **Belum dinyalakan** di produksi (default mati) — ini keputusan yang wajar diambil NANTI, setelah
  build 1.0.0+4 sempat beredar dan driver sempat update, bukan sekarang.

Uji: `driverMinAppBuildGate.integration.test.ts` (backend, 7 test baru).

## Langkah menuju Google Play Store (E5, sebagian)

Bukan perubahan yang terasa di aplikasi, tapi bagian dari syarat submit ke Play Console:

- Kebijakan privasi (`tapgolion.id/privacy-policy`) sekarang punya bagian khusus untuk data yang
  dikumpulkan aplikasi driver — sebelumnya halaman itu cuma membahas aplikasi penumpang, dan bahkan
  secara keliru menyatakan "tidak mengumpulkan KTP" (benar untuk penumpang, salah untuk driver).
- Draf lengkap siap-pakai untuk Play Console: deskripsi listing, pemetaan Data Safety, dan skrip akun
  uji reviewer — lihat `docs/release/GOOGLE_PLAY_DRIVER_APP_LISTING_DRAFT.md`,
  `docs/release/GOOGLE_PLAY_DRIVER_APP_DATA_SAFETY_MAPPING.md`,
  `docs/release/DRIVER_APP_REVIEWER_TEST_ACCOUNT.md`.
- Ikon 512×512 dan feature graphic 1024×500 untuk listing sudah dibuat (`google-play-assets/driver/`).

## Fitur baru: verifikasi wajah ulang acak + pengingat kelelahan (diadaptasi dari Gojek/Grab)

Owner meminta riset fitur keamanan/tampilan Gojek dan Grab yang relevan untuk TapGo, lalu meminta 2
rekomendasi teratas dikerjakan langsung. Keduanya tunduk pada `DRIVER_FACE_CHECK_ENABLED` yang sama
(masih MATI di produksi hari ini) untuk bagian verifikasi wajah — pengingat kelelahan berjalan
independen dari flag itu.

**Verifikasi wajah ulang acak selama online** (meniru Gojek, yang memverifikasi ulang "sewaktu-waktu
saat mitra driver mengaktifkan aplikasi", bukan cuma sekali per hari):
- Setelah PASSED verifikasi harian, server menjadwalkan verifikasi ULANG di waktu acak (default 2-5
  jam kemudian, `DRIVER_FACE_CHECK_RECHECK_MIN_MINUTES`/`_MAX_MINUTES`).
- driver_app mengecek jadwal ini tiap 3 menit selama online lewat `GET /driver/safety-status`. Begitu
  jatuh tempo, banner "Verifikasi ulang wajah diperlukan" tampil di Beranda dengan tombol membuka
  layar kamera yang sama dengan verifikasi harian (mode `isRecheck`).
- **Penegakan OTORITATIF ada di server, bukan di banner**: selama recheck belum lolos,
  `listOffersForDriver` dan `acceptOrder` SAMA-SAMA menolak — driver tidak akan melihat maupun bisa
  menerima pesanan apa pun, terlepas dari apakah ia membuka/mengabaikan bannernya. Ini pola yang sama
  dengan pemeriksaan kendaraan terverifikasi yang sudah ada.
- Gagal recheck (wajah tidak cocok) memaksa driver OFFLINE seketika di server — BUKAN memblokir sisa
  hari seperti gagal verifikasi harian (itu hukuman yang salah sasaran untuk kejadian setelah driver
  sudah lolos verifikasi awal).
- Endpoint baru: `POST /driver/face-check/recheck-attempt`, `GET /driver/safety-status`.

**Pengingat kelelahan** (meniru ambang batas Grab yang sudah dipublikasikan: mobil 10 jam, motor 11
jam online tanpa jeda):
- Server melacak `onlineSince` (diisi saat OFFLINE→ONLINE, dikosongkan saat →OFFLINE, TIDAK direset
  oleh ONLINE↔BUSY — menerima/menyelesaikan order tidak menghentikan jam kerja).
- Sengaja HANYA pengingat (banner di Beranda, "Anda sudah online X jam Y menit..."), TIDAK memblokir
  status online atau tawaran — mengunci akses adalah keputusan bisnis yang memengaruhi penghasilan
  driver dan butuh keputusan eksplisit Owner terpisah, bukan default teknis dari fitur ini.
- Ambang bisa disetel lewat `DRIVER_FATIGUE_CAR_MAX_ONLINE_MINUTES`/`DRIVER_FATIGUE_MOTORCYCLE_MAX_ONLINE_MINUTES`;
  driver dengan lebih dari satu jenis kendaraan aktif memakai ambang PALING KETAT di antara jenisnya.

Uji: 12 test baru di `driverFaceCheck.integration.test.ts` (recheck due/tidak due, lolos/gagal, paksa
offline, ambang kelelahan per jenis kendaraan, onlineSince bertahan lewat BUSY), 3 test baru di
`driverOffersProximity.integration.test.ts` (listOffersForDriver dan acceptOrder menolak saat recheck
due). driver_app: 3 test widget baru (banner kelelahan muncul/hilang, banner recheck membuka layar
yang benar, recheck diutamakan di atas kelelahan saat keduanya aktif).

## Perbaikan setelah uji HP 4 Oktober 2026 (build ulang 1.0.0+4)

Owner menguji APK 1.0.0+4 sebelumnya dan melaporkan kemunduran: halaman Login menampilkan
"Koneksi belum stabil. Silakan coba lagi." Penelusuran akar masalah dan audit menyeluruh
menghasilkan perubahan berikut (semua tercatat di `REGRESSION_REGISTER.md` beserta ujinya).

**Akar masalah laporan itu** — bukan regresi kode. Pin TLS di APK adalah hash SPKI sertifikat *leaf*
server; Let's Encrypt menerbitkan kunci leaf baru tiap perpanjangan, dan sertifikat diperbarui
3 Okt 2026, jadi pin di APK lama tidak cocok lagi dan SETIAP permintaan gagal handshake. Tiga bukti
independen: (1) string pin yang tertanam di `libapp.so` APK, (2) hash SPKI sertifikat live berbeda,
(3) fungsi pin menolak pin lama terhadap sertifikat live dan menerima pin baru.

**Yang diperbaiki di aplikasi**
- Kegagalan sertifikat/TLS kini dibedakan dari gangguan sinyal dan menampilkan pesan yang bisa
  ditindaklanjuti ("Perbarui aplikasi dari Google Play…"), dan dilaporkan sekali ke Sentry bila aktif.
- Login ditolak (kata sandi salah) tetap di form login dengan pesan Indonesia, bukan layar
  "Sesi berakhir".
- Pesan galat server berbahasa Inggris dipetakan ke pesan Indonesia.
- Gangguan jaringan sesaat saat polling tidak lagi menutup workspace dan tidak menghentikan polling
  serta pengiriman lokasi (bug lama yang paling berbahaya saat di tengah perjalanan).
- SOS: galat tak terduga tidak membuat tombol macet; WhatsApp CS tetap tersedia.
- Wizard pengajuan tidak lagi tertutup oleh pesan galat yang berisi kata "terkirim".
- Tautan isi saldo dari server hanya dibuka bila https ke tapgolion.id.
- Izin `RECORD_AUDIO` dan `READ_MEDIA_IMAGES` dihapus (tidak dipakai); foto wajah sementara dihapus
  setelah verifikasi; warna teks mode gelap diperbaiki.

**Yang diperbaiki di proses rilis**
- `scripts/check-tls-pin-live.sh` membandingkan pin dengan sertifikat live; gerbang rilis membatalkan
  build bila tidak cocok, dan memeriksa bahwa pin benar-benar tertanam di APK.
- Vektor uji berisi sertifikat produksi diganti sertifikat sintetis; uji TLS memakai handshake
  sungguhan.

**Syarat agar APK ini tetap berfungsi (tindakan Owner, bukan kode)**
1. **Rotasi kunci sertifikat.** Pin leaf akan basi lagi pada perpanjangan berikutnya (±60 hari sejak
   3 Okt 2026, yaitu sekitar awal Desember 2026) kecuali certbot memakai `reuse_key`. Atur di VPS
   (`renew_before_expiry`/`reuse_key = True` pada berkas renewal certbot untuk domain API), lalu
   jalankan `scripts/check-tls-pin-live.sh` terjadwal sebagai pemantau.
2. **Backend produksi harus memuat endpoint dari PR #1** (`POST /driver/sos`,
   `GET /driver/safety-status`, `POST /driver/face-check/recheck-attempt`) sebelum APK ini dipakai di
   lapangan. Di produksi yang hanya menjalankan branch `release/membership-manual-transfer`, tiga
   endpoint itu membalas `ROUTE_NOT_FOUND`: SOS gagal (dengan pesan jelas dan jalur WhatsApp CS),
   banner kelelahan/verifikasi ulang tidak muncul.
3. user_app memakai desain pin yang sama dan berisiko sama; pin-nya perlu diperiksa dengan skrip yang
   sama sebelum rilis berikutnya.

## Yang TIDAK bisa diselesaikan dari sisi kode (butuh tindakan Owner langsung)

Ditulis jujur supaya tidak ada kesan "100% siap Play Store" padahal belum:

- **E1 — Uji lapangan 2 HP sungguhan**: 8 skenario di `DRIVER_APP_READINESS_PLAN.md` belum pernah
  dijalankan dua kali berturut di hari berbeda dengan hasil tercatat.
- **E2 — Keamanan verifikasi wajah**: server masih mempercayai skor kemiripan yang dihitung DAN
  dikirim aplikasi sendiri. Sengaja DITUNDA sesuai rekomendasi rencana sendiri — wajib selesai sebelum
  E7 (rilis publik), tidak wajib sebelum closed testing (E6) dengan driver pilot yang dikenal langsung.
- **E3 — Uang sungguhan**: uji top up manual + komisi 8% dengan transfer bank sungguhan belum
  dituntaskan Owner.
- **E5 (sisa)**: mengisi form Data Safety dan deklarasi foreground-service SUNGGUHAN di Play Console,
  screenshot dari HP asli (minimal 4) — semuanya hanya bisa dilakukan di dalam Play Console atau dari
  HP Owner.
- **E6 — Closed testing**: minimal 1 minggu kalender dengan 5-10 driver pilot sungguhan.
- **E7 — Rilis bertahap**: aksi di Play Console yang cuma Owner bisa lakukan.

Estimasi rencana sendiri: **4-6 minggu kalender** dari titik ini sampai benar-benar 100% siap publik,
sebagian besar karena E1/E6 butuh waktu kalender nyata (uji lapangan, closed testing 1 minggu), bukan
karena ada pekerjaan kode yang belum ditemukan.

## Uji

- Backend: 1226 test lolos (SOS, gerbang versi minimum, recheck wajah + kelelahan).
- driver_app: 160 test lolos (20 dilewati: bukti visual, bawaan), `flutter analyze` bersih, gerbang rilis lolos pada 4 Okt 2026.
