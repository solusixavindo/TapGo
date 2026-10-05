# Analisis akar masalah uji HP driver +12 dan rencana perbaikan

> **Status pelaksanaan (6 Okt 2026):** tahap A sampai F SELESAI dan dibangun sebagai driver 1.0.0+13 dan
> user_app 2.0.5+38 (lihat `DRIVER_APP_1_0_0_13_RELEASE_NOTES.md` dan `USER_APP_2_0_5_38_RELEASE_NOTES.md`).
> Keputusan Owner: ikon Opsi 1 (emas di latar navy), saran tempat lewat Photon publik, cutover backend belum
> dijalankan. Deviasi dari rencana: pemetaan kategori OSM tidak dibuat karena uji langsung menunjukkan Photon
> sudah memadai; `SentryFlutter.init` tidak diubah (tidak terbukti perlu). Pratinjau ikon: `pratinjau_ikon_driver.png`.
> Belum ada uji HP untuk +13/+38.

Tanggal: 2026-10-06. Sumber: temuan uji HP Owner pada `tapgo-driver-1.0.0+12.apk` (5 butir + permintaan
peningkatan performa). Tidak ada HP terhubung ke Mac ini (`adb devices` kosong), jadi semua yang di bawah
dibedakan menjadi **TERBUKTI** (dari kode atau uji langsung) dan **DUGAAN** (belum bisa dibuktikan tanpa HP).

## 1. Bunyi/suara tidak berjalan

**TERBUKTI**
- **Latar belakang (FCM):** backend produksi (`tapgo-5588076`) masih mengirim `channel_id: "tapgo_default"`.
  Channel itu sudah terkunci senyap di HP Anda oleh APK lama, jadi notifikasi latar belakang tetap senyap
  berapa pun APK-nya. Perbaikannya sudah ada di `release/driver-rating` (`tapgo_alerts_v2`) tetapi **belum
  di-cutover**. Ini murni pekerjaan server.
- **Push order ke driver hanya terkirim bila semua syarat ini benar** (kode `RideService.ts` ±122-160):
  `FIREBASE_SERVICE_ACCOUNT_JSON` terisi di produksi, driver ONLINE, ada titik lokasi **segar**, kendaraan
  aktif dan terverifikasi dengan jenis yang sama, dalam radius `RIDE_OFFER_RADIUS_METERS` (5 km), dan akun
  driver bukan akun penumpang order itu. Satu syarat gagal = tidak ada push sama sekali.
- **Aplikasi di depan:** jalur kode sudah benar sampai ke MethodChannel (tes membuktikan satu ringtone per
  referensi). Yang tidak dapat saya buktikan adalah apa yang dilakukan HP Anda saat `Ringtone.play()` dipanggil.

**DUGAAN (belum terbukti)** untuk bunyi saat aplikasi terbuka, dari yang paling mungkin:
1. Nada notifikasi bawaan HP "Tanpa suara"/sangat pelan, atau volume *notifikasi* (bukan volume media) nol;
   +12 memakai nada bawaan itu.
2. Izin notifikasi Android 13+ ditolak: tidak memengaruhi ringtone, tetapi mematikan semua notifikasi
   (termasuk fallback dan FCM latar belakang).
3. Mode Jangan Ganggu/senyap per aplikasi.

**Mengapa saya tidak menebak lagi:** dua perbaikan bunyi sebelumnya (+10, +11) dibangun dari dugaan. Rencana
di bawah dimulai dengan **bukti dari HP**.

## 2. Notifikasi pesan chat masuk

**TERBUKTI:** satu-satunya pemicu popup chat di driver (dan user_app) adalah push FCM `chat_message`. Tidak
ada jalur cadangan: bila FCM tidak sampai (butir 1: konfigurasi server, izin, channel), pesan masuk tanpa
tanda apa pun sampai driver membuka layar chat. Poll 4 detik hanya berjalan **saat layar chat sudah dibuka**.
Satu titik gagal tunggal.

**Fakta yang memudahkan:** `GET /api/v1/chat/conversations` sudah ada di backend produksi (dipakai user_app)
dan sudah melayani driver (query `passengerId` ATAU `driverProfile.userId`), memuat `unreadCount` dan pesan
terakhir. Jadi perbaikan tidak butuh rilis backend.

## 3. Penilaian: error dan tampilan

**(a) Error "Penilaian belum tersedia di versi layanan saat ini" — TERBUKTI penyebabnya.** Kalimat itu hanya
dipetakan dari kode `ROUTE_NOT_FOUND`, artinya server menjawab "route tidak ada". Aplikasi memanggil URL yang
benar (`POST /api/v1/rides/{ref}/rating`); proses produksi `tapgo-5588076` tidak memuat route itu. Selama
cutover `release/driver-rating` belum dijalankan, error ini akan muncul pada setiap kiriman. Bila cutover
sudah dijalankan dan error masih muncul, berarti proses yang aktif bukan folder baru (`pm2 describe tapgo-api`
→ `exec cwd`): kirimkan hasilnya ke saya.

**(b) Tampilan — kekurangan desain, bukan bug.** Kartu penilaian hanya satu kartu di bawah kartu perjalanan di
layar status; penumpang harus menggulir dan melihatnya setelah "Perjalanan selesai". Model Gojek: begitu status
COMPLETED, penumpang langsung dibawa ke halaman penilaian penuh.

## 4. Titik jemput: "stasiun" tidak memunculkan saran

**TERBUKTI lewat uji langsung ke Nominatim dengan parameter yang sama dengan aplikasi** (3 kota):
- Nominatim **tidak mendukung ketik-sambil-mencari**: di sekitar Serang `sta`, `stas`, `stasi`, `stasiu`,
  `stasiun ser` = **0 hasil**; baru `stasiun` utuh yang menghasilkan 12. Aplikasi mencari tiap 450 ms saat
  mengetik, jadi sepanjang pengetikan kotak saran kosong. Kebijakan Nominatim publik juga melarang
  autocomplete.
- Kata kategori umum lemah: "rumah sakit" ±3 km Serang = 0, dan ±39 km = 3 hasil.
- **Photon (geocoder OSM yang mendukung awalan kata dan bias lokasi)** pada kasus yang sama: `sta` → Stasiun
  Serang, Stadion Maulana Yusuf, …; `stasi`, `rumah sa`, `alfamart` semuanya 8 hasil relevan dan terdekat
  lebih dulu.
- Tambahan: bila posisi HP belum ada, pencarian menunggu pembacaan GPS (sampai ±24 detik) dan tiap pelebaran
  kotak menambah jeda ≥ 1,1 detik; pengguna melihat kotak saran kosong.

## 5. Ikon: logo terlalu kecil

**TERBUKTI (diukur dari berkas):** pada kanvas adaptif 108 dp, gambar logo hanya 48% lebar × 46% tinggi, dan
isi tintanya tipis (kepadatan 37% dalam kotaknya). Area yang terlihat setelah peluncur memotong hanyalah
lingkaran 72 dp (67% kanvas); gambar menempati 72% lebar area itu, tetapi garis halus singa, mobil, dan motor
hilang pada ukuran ikon asli (48 dp). Penyebabnya berlapis: (1) komposisi lambang+kendaraan yang detail,
(2) di +9 saya menskalakan dengan lingkaran pembatas konservatif (0,30 × kanvas) demi zona aman, (3) latar emas
dan tinta navy tipis kurang kontras pada ukuran kecil.

**Temuan sampingan:** `ic_launcher.png` lama (Android 7.x) masih ikon berteks "TAPGO DRIVER" + motor + mobil;
ikon iOS/macOS driver masih ikon bawaan Flutter (tidak memengaruhi Play); notifikasi memakai ikon peluncur
berwarna sebagai ikon kecil (pada bilah status Android tampil sebagai gumpalan putih; **dugaan**, belum diuji di HP).

**Sumber resolusi tinggi sudah ada:** `apps/landing-page/public/images/tapgo-logo.png` (1280×1088): lambang
perisai singa-T emas di atas navy, resmi, tajam. Memperbesar lambang ini bukan menggambar merek baru.

## 6. Rencana perbaikan (setiap langkah = APK baru, Anda uji dulu; tanpa unggah Play sebelum Anda setuju)

### Tahap A — bukti bunyi dari HP (driver +13, kecil, cepat)
1. Tombol **"Uji bunyi"** di tab Akun driver (dan user_app): memutar ringtone lalu menampilkan hasil nyata:
   izin notifikasi, status & suara channel `tapgo_alerts_v2`, mode dering, volume notifikasi, filter Jangan
   Ganggu, nada notifikasi bawaan, apakah `play()` benar-benar berjalan. Satu ketukan di HP = penyebab pasti.
2. Bunyi order memakai **file suara bawaan aplikasi** (`res/raw`, pendek, khas) bukan nada bawaan HP; dipakai
   untuk channel `tapgo_alerts_v2` dan pemutaran saat aplikasi di depan, tetap `USAGE_NOTIFICATION` (HP senyap
   tetap senyap). Menghilangkan dugaan 1 sepenuhnya.
3. Saat izin notifikasi ditolak: banner di Beranda + tombol ke pengaturan (tombol ada di kode sejak lama).
4. Tes yang gagal bila bunyi kembali bergantung pada nada bawaan atau channel lama.

### Tahap B — chat yang tidak bergantung pada FCM (driver +13, user_app +38)
1. Poll `GET /chat/conversations` bersama siklus workspace (12 detik; sudah berjalan saat ada perjalanan
   aktif) dan di user_app saat ada perjalanan aktif (bukan 30 detik tetap).
2. `unreadCount` naik untuk perjalanan yang layar chat-nya tidak terbuka → popup (yang sudah ada) + bunyi
   (satu kali per pesan baru; dedupe terhadap push FCM berdasarkan referensi + hitungan).
3. **Tanda yang menetap:** titik merah/angka pada tombol chat di kartu perjalanan aktif dan pada tab,
   hilang setelah dibaca. Itu "tanda lain" yang Anda minta.
4. Tes: pesan masuk tanpa FCM tetap memunculkan popup + titik merah; chat terbuka = senyap; tanpa duplikat.

### Tahap C — penilaian ala Gojek (user_app +38; butuh cutover backend untuk mengirim)
1. Saat status menjadi COMPLETED: langsung buka **halaman penilaian penuh**: nama dan ringkasan driver,
   "Bagaimana perjalananmu?", bintang besar, chip cepat (Ramah, Tepat waktu, Berkendara aman, Kendaraan
   bersih), catatan opsional, **Kirim** dan **Lewati**; lalu terima kasih dan kembali ke dashboard.
2. Dibuka juga bila penumpang membuka lagi perjalanan selesai yang belum dinilai (dari Aktivitas).
3. **Antrean lokal:** bila server belum punya route (atau offline), penilaian disimpan di perangkat dan dikirim
   ulang otomatis; layar menampilkan "Terima kasih, penilaianmu akan dikirim" — tidak lagi pesan error merah.
4. **Wajib bersamaan (pekerjaan Anda di server):** cutover `release/driver-rating` (panduan ada di jawaban
   saya sebelumnya). Tanpa itu penilaian hanya tersimpan di antrean.

### Tahap D — saran tempat yang benar-benar muncul (user_app +38; backend proxy opsional)
1. Ganti sumber saran dengan **geocoder yang mendukung awalan kata dan bias lokasi** (Photon), berpusat pada
   posisi HP; Nominatim tetap sebagai cadangan. Urutan jarak haversine tetap.
2. Dapatkan saran **langsung** setelah 1-2 huruf, tanpa menunggu GPS: pakai posisi terakhir yang diketahui
   (cache) dan perbarui saat GPS siap; tampilkan indikator memuat, bukan kotak kosong.
3. Kategori umum (stasiun, bandara, terminal, rumah sakit, mall, SPBU, masjid) dipetakan ke tag OSM sehingga
   "rumah sakit" tidak bergantung pada kecocokan nama.
4. **Keputusan Anda (lihat bagian 7):** Photon publik (`photon.komoot.io`) gratis tetapi tanpa SLA dan
   bergantung pada kebijakan pemakaian wajar. Bila ingin andal untuk produksi: lewat **proksi backend** dengan
   cache, atau Photon di VPS sendiri.

### Tahap E — ikon besar (driver +13)
Saya buat **gambar pratinjau perbandingan** (ikon saat ini vs 2-3 opsi, pada ukuran peluncur 48 dp, bentuk
lingkaran/squircle) sebelum membangun apa pun:
- **Opsi 1:** lambang perisai singa-T resmi (tanpa mobil/motor/teks) emas di atas **latar navy** penuh, mengisi
  ±85% area terlihat (kontras tertinggi, paling dekat dengan logo resmi). Mengubah latar dari emas.
- **Opsi 2:** tetap latar emas `#FFC857`, lambang resmi navy diperbesar maksimal dalam zona aman.
- **Opsi 3:** tetap komposisi sekarang diperbesar ke batas lingkaran terlihat (+10%, perbaikan kecil).
Ikut diperbaiki: `ic_launcher.png` lama (Android 7), ikon kecil notifikasi monokrom (`ic_stat_tapgo`), dan
ikon Play Store 512 + foreground adaptif dari sumber 1280 px.

### Tahap F — performa driver_app (rencana; ukur dulu, baru ubah)
**Temuan statis (terukur dari kode/AAB, bukan dari HP):**
- Tiap siklus 12 detik tanpa perjalanan aktif memanggil **3 permintaan berurutan** (`currentRide`, `offers`,
  `availability`) + lokasi tiap 5 detik (12 permintaan/menit) + status keselamatan tiap 3 menit.
  `offers` dan `availability` dapat dijalankan paralel (`Future.wait`).
- Layar membaca **seluruh state** controller dengan `ref.watch(driverControllerProvider)` (9 tempat di
  `driver_screens.dart`, hanya 1 memakai `select`): tiap poll/pembaruan membangun ulang layar penuh walau
  datanya tidak berubah.
- Unduhan AAB 58,5 MB sudah tanpa x86_64; 19,6 MB di antaranya simbol debug (tidak diunduh pengguna).
  Pustaka native arm64 ±15 MB, aset 4,2 MB. Tidak ada model wajah (fitur nonaktif).
- `SentryFlutter.init` ditunggu sebelum `runApp` (menambah waktu mulai dingin bila DSN diisi).

**Langkah:** (1) ukur di HP: waktu mulai dingin (`adb shell am start -W`), jumlah rebuild (DevTools),
pemakaian data dan baterai selama 30 menit online; (2) `select` per bagian state pada layar yang paling sering
berubah; (3) paralelkan `offers`+`availability`; (4) polling adaptif (cepat saat aplikasi di depan dan Online,
lambat di latar belakang, berhenti saat Offline), mengandalkan push untuk order; (5) pindahkan
`SentryFlutter.init` ke `appRunner`. Hasil dilaporkan sebelum/sesudah, bukan klaim.

## 7. Yang saya perlukan dari Anda (maksimal 4 keputusan)
1. **Server:** sudah/belum cutover `release/driver-rating`? Tanpa itu butir 3 dan bunyi latar belakang tidak
   bisa berhasil. Bila belum, mau saya pandu sekarang?
2. **Saran tempat:** Photon publik langsung (cepat, tanpa SLA), proksi backend dengan cache (lebih andal,
   butuh rilis backend), atau layanan berbayar/bawaan sendiri. Rekomendasi: Photon langsung dulu untuk uji HP
   Anda, lalu proksi backend sebelum produksi publik.
3. **Ikon:** pilih opsi 1/2/3 setelah melihat pratinjau (saya buatkan dulu).
4. **Urutan:** usul A → B → C → D → E → F, dua APK per putaran agar uji HP Anda tidak menumpuk.
