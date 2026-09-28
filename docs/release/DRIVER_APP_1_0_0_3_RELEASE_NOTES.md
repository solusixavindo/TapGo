# TapGo driver_app 1.0.0+3

Tanggal mulai: 2026-09-26. Rencana lengkap: `DRIVER_APP_READINESS_PLAN.md`.

## Tahap D1 (selesai): bisa dibangun dan diserahkan
- Build rilis kini berhasil. Tiga penyebab gagal diperbaiki: target JVM plugin `tflite_flutter`, `compileSdk` plugin
  (android-31 vs dependensi AndroidX >= 34), dan aturan R8 untuk delegasi GPU TFLite yang opsional.
- Kunci unggah khusus driver (terpisah dari kunci user_app), disimpan di `apps/driver_app/android/keystore/` (diabaikan git).
- `scripts/release-gate-driver-app.sh` dan job CI `driver_app_release_artifact` (build rilis + pemindai artefak).

## Tahap D2 (selesai): tawaran hanya untuk driver yang dekat
- Driver hanya melihat dan bisa menerima pesanan dalam radius 5 km dari posisi terbarunya (posisi maksimal 60 detik).
  Tawaran diurutkan dari yang terdekat dan menampilkan jarak ke titik jemput.
- Pesanan tanpa driver setelah 3 menit menjadi "Driver belum ditemukan" dan penumpang diberi tahu.

## Tahap D3 (selesai): tetap menerima pesanan saat layar mati
- Layanan latar depan (notifikasi "TapGo Driver aktif") menjaga lokasi tetap terkirim selama driver ONLINE atau
  punya perjalanan; mati otomatis saat OFFLINE.
- Notifikasi push (FCM): pesanan baru di dekat driver, dan pembatalan oleh penumpang.
- Izin baru: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`.

## Tahap D4 (selesai): alur kerja driver
- Pembatalan oleh driver memilih alasan (penumpang tidak bisa dihubungi, titik jemput tidak sesuai, kendaraan
  bermasalah, menunggu terlalu lama, lainnya).
- Tab Pendapatan: **Saldo TapGo**, catatan komisi, tombol isi saldo (tapgolion.id), dan riwayat potongan komisi/isi saldo.
- Komisi 8% pesanan tunai dipotong dari saldo saat perjalanan selesai; pesanan tunai hanya bisa diterima bila
  saldo cukup. **Aktif hanya bila server memasang `DRIVER_COMMISSION_ENABLED=true`.**
- Top up manual transfer bank di tapgolion.id/topup, dikonfirmasi Super Admin (server: `MANUAL_TOPUP_ENABLED=true`).

## Tahap D4.1 (selesai): perbaikan dari uji HP pertama (27 Sep 2026)
4 laporan Owner dari uji `tapgo-driver-1.0.0+3.apk` di HP asli, semuanya diperbaiki dengan akar masalah
dibuktikan dan uji penjaga ditambahkan (lihat `REGRESSION_REGISTER.md`):
- **Online selalu gagal** ("Verifikasi wajah belum diaktifkan"): bug server, bukan hanya tampilan. Setiap
  driver, di setiap kondisi, tidak bisa online selama `DRIVER_FACE_CHECK_ENABLED=false` (nilai bawaan
  sekarang) — diperbaiki di backend, sudah di-deploy terpisah dari paket ini (lihat percakapan deploy).
- **Masuk dengan Google gagal**: server TIDAK PERNAH punya endpoint untuk ini (`/auth/google` 404 sejak awal),
  bukan masalah satu akun. Diperbaiki dan di-deploy di backend; **butuh dua langkah manual dari Owner**
  (`GOOGLE_OAUTH_CLIENT_ID` di `.env` VPS, dan SHA-1 kunci unggah driver didaftarkan di Google Cloud Console)
  sebelum benar-benar berfungsi — lihat pesan terpisah.
- **Kartu "Ajukan Jadi Mitra Driver" nyangkut** di tab Akun walau driver sudah aktif: disembunyikan otomatis
  begitu driver punya kendaraan aktif.
- **Ikon aplikasi**: latar kotak navy dihapus, tersisa lencana emas (bingkai + lambang) pada latar transparan.

Sekaligus dikerjakan (bagian dari permintaan "menu selevel Gojek/Grab"): tab Akun sekarang punya kartu
**Tampilan** (Terang/Gelap/Ikuti sistem, tersimpan permanen) dan **Notifikasi** (tombol ke pengaturan
notifikasi bawaan Android — suara/getar diatur Android sejak versi 8, aplikasi tidak bisa mengubahnya
langsung), serta kartu **Bantuan** (WhatsApp dan Kebijakan Privasi, kontak sama dengan aplikasi penumpang).

**Temuan keamanan yang BELUM diperbaiki, dilaporkan ke Owner secara terpisah:** verifikasi wajah harian
mempercayai skor kemiripan yang dihitung DAN dikirim oleh aplikasi sendiri — server tidak menghitung ulang
dari foto. Ini desain lama (didokumentasikan di skema Prisma), bukan sesuatu yang baru rusak, tetapi berarti
aplikasi yang dimodifikasi bisa melewati verifikasi tanpa wajah asli di depan kamera. Perbaikan penuhnya
butuh pemrosesan di server (perubahan arsitektur, bukan tambalan kecil) — belum dikerjakan, menunggu
keputusan Owner, dan tidak mendesak selama `DRIVER_FACE_CHECK_ENABLED` masih mati.

## Tahap D4.2 (selesai): perbaikan dari uji 2 HP kedua (28 Sep 2026)
3 laporan Owner dari uji di 2 HP fisik berbeda, semuanya diperbaiki dengan akar masalah dibuktikan dan uji
penjaga ditambahkan (lihat `REGRESSION_REGISTER.md`):
- **Ikon masih bermasalah** (bingkai ganda, kotak putih di dalam bingkai gold): perbaikan D4.1 di atas SALAH
  ARAH — Owner minta sudut kotak dihilangkan, BUKAN warna latar navy. PNG legacy transparan yang dibuat D4.1
  justru menyebabkan launcher tertentu (gaya MIUI) menambah bentuk latarnya sendiri di atas ikon, jadi
  bingkai ganda. Diperbaiki tuntas dengan Android Adaptive Icon sungguhan (layer foreground = lencana emas,
  layer background = warna navy solid `#061A2F`) — setiap launcher memotong bentuknya sendiri tanpa
  bingkai ganda, latar navy tetap ada.
- **Tombol "Terima" tawaran mati total**: bug backend, bukan hanya tampilan — field `status` tidak pernah
  dikirim pada objek tawaran, jadi driver_app menganggap statusnya "tidak dikenal" dan mengunci tombol untuk
  SETIAP tawaran, di SEMUA driver. Diperbaiki di backend.
- **Tidak ada notifikasi pop-up saat order masuk**: pesan push ditimpa dalam hitungan ratusan milidetik oleh
  proses pemuatan ulang daftar tawaran yang berjalan tepat setelahnya. Diganti dengan SnackBar yang tidak
  bergantung pada state Riverpod, pola sama yang sudah terbukti di user_app.

**Belum tuntas, masih diselidiki:** masuk dengan akun Google masih gagal untuk 2 akun berbeda di 2 HP
berbeda (`sandikanur404@gmail.com`, `febrina.delia...@gmail.com`), walau backend sudah dikonfirmasi hidup,
`GOOGLE_OAUTH_CLIENT_ID` sudah cocok server-klien, dan SHA-1 kunci unggah driver sudah didaftarkan di
Firebase Console. Dugaan utama saat ini (belum dikonfirmasi): status publikasi OAuth consent screen di
Google Cloud Console masih "Testing" dengan daftar test-user terbatas yang tidak memasukkan kedua akun
tersebut. Perlu Owner memeriksa Google Cloud Console → APIs & Services → OAuth consent screen.

## Perbaikan backend-only (tidak perlu APK baru)

- **Error Sentry "No recipients defined"** (`TAPGO-BACKEND-1`, `POST /auth/verification/request`):
  provider OTP produksi (email) menerima permintaan kanal PHONE tanpa diperiksa dulu, meneruskan nomor
  HP sebagai alamat email ke nodemailer. Sekarang ditolak bersih (503) sebelum menyentuh nodemailer.
  Verifikasi nomor HP lewat OTP **masih belum benar-benar berfungsi** di production — belum ada provider
  SMS/WhatsApp, hanya email — perbaikan ini membuat kegagalannya terlihat jelas, bukan membuatnya bekerja.
- **Satu akun DRIVER bisa aktif bersamaan di 2 HP** (temuan Owner, uji 2 HP 28 Sep 2026, akun "febrina"):
  login tidak pernah mencabut sesi lama akun yang sama. Sekarang login DRIVER lewat driver_app mencabut
  seketika seluruh sesi lama akun itu di HP lain — HP lama langsung diminta login ulang pada request
  berikutnya, bukan menunggu token-nya kedaluwarsa. Dibatasi hanya role DRIVER dan kanal app (tidak
  menyentuh USER maupun dashboard web mitra). driver_app sudah punya penanganan sesi-tercabut yang baik
  sejak sebelumnya, jadi tidak perlu APK baru untuk perbaikan ini.
- **"Too many attempt" saat login/pakai app normal**: `/auth/refresh` (trafik latar belakang otomatis)
  berbagi kuota rate limit dengan `/login`/`/google` — dibuktikan langsung dari log produksi. Sekarang
  `/refresh` punya kuota terpisah (100/15 menit) dan kuota login dinaikkan (20 → 30/15 menit, masih ketat
  untuk brute force). Efek berantai yang ikut selesai: HP yang kena 429 tidak bisa login ulang untuk
  mendaftarkan ulang token push — kemungkinan besar penyebab laporan "tidak ada popup notifikasi" di sesi
  uji yang sama.

## Tahap D4.3 (selesai sebagian): perbaikan dari uji 2 HP ketiga (29 Sep 2026)
6 laporan Owner. 3 backend (di atas, live setelah deploy), 1 driver_app (di bawah, APK baru), 1 butuh
tindakan Owner di Firebase Console (belum bisa saya perbaiki sendiri), 1 permintaan fitur (perlu klarifikasi):

- **Kartu "Perjalanan aktif" di Beranda basi**: tetap "Dalam Perjalanan" walau tab Pesanan > Riwayat sudah
  "Selesai". `activeRide` hanya disegarkan lewat polling 12 detik atau app-resume — tidak ada apa pun yang
  menyegarkannya saat driver sekadar berpindah tab. Sekarang Beranda menyegarkan diri setiap kali dibuka
  (termasuk kembali dari tab lain), bukan hanya menunggu timer.
- **Masuk dengan Google — akar masalah SELESAI dikonfirmasi dan diperbaiki**, bersama Owner langsung
  di Google Cloud Console: `kGoogleServerClientId` lama (project `637941236322`) bukan project yang bisa
  diakses akun Google TapGo sama sekali — dikonfirmasi dua arah: project Firebase `tapgo-c7cb3` sendiri
  "No OAuth clients to display", dan pencarian project `637941236322` di akun TapGo "No results found".
  SHA-1 driver yang didaftarkan sebelumnya di Firebase Console SUDAH BENAR, tapi tidak relevan karena
  Sign-In memakai client ID dari project lain yang tidak terjangkau siapa pun di TapGo. Ditemukan juga:
  OAuth consent screen project `tapgo-c7cb3` masih "Testing" dengan **0 test user terdaftar** — akan
  gagal untuk akun manapun terlepas dari benar-tidaknya kredensial.
  Diperbaiki dengan membuat OAuth Client ID baru (Android + Web) di project `tapgo-c7cb3` yang sepenuhnya
  dikuasai Owner, SHA-1 driver yang sudah dikonfirmasi cocok dengan keystore rilis sungguhan; kode
  (`kGoogleServerClientId`) dan `.env` backend (`GOOGLE_OAUTH_CLIENT_ID`) diperbarui ke Web Client ID
  baru; `sandikanur404@gmail.com` dan `febrina.delia@gmail.com` ditambahkan sebagai test user.
  **Belum tuntas**: publikasi penuh OAuth consent screen (lepas dari daftar test user terbatas, supaya
  SEMUA driver bisa pakai akun Google apa saja) — butuh melengkapi halaman Branding (logo, link
  kebijakan privasi, dst) di Google Cloud Console, tugas terpisah berikutnya. Verifikasi akhir menunggu
  Owner instal APK dan login sungguhan.
- **"Perlu opsi jawaban otomatis untuk driver"**: permintaan fitur baru, belum jelas cakupannya (balasan
  otomatis untuk chat penumpang saat mengemudi? Sesuatu yang lain?) — ditanyakan ke Owner sebelum dibangun,
  supaya tidak salah arah.

## Perbaikan tambahan dari verifikasi ulang (sebelum deploy, bukan laporan baru)
Owner meminta pemeriksaan ulang menyeluruh sebelum deploy. Satu temuan nyata:
- **Ikon: kartu navy sedikit melewati safe-zone 66dp resmi Android.** Perbaikan bingkai gold sehari
  sebelumnya menghitung rasio ukuran dengan cara yang salah (lebar konten vs diameter safe-zone, bukan
  jarak sudut konten dari pusat). Diukur langsung dari piksel PNG sungguhan (bukan geometri kotak
  pembatas): melewati 30px dari radius aman. TIDAK menimbulkan bug "terputus" seperti sebelumnya (gold
  tetap solid sebagai background, jadi selalu utuh), tapi diperbaiki sampai benar-benar sesuai
  spesifikasi — sekarang bermargin 13px di dalam batas aman, diverifikasi ulang dengan pengukuran piksel
  yang sama. APK yang dikirim sudah memakai versi terkoreksi ini.

## Tahap D4.4 (selesai): retest 2 HP setelah Google Sign-In berfungsi (29 Sep 2026)
Owner konfirmasi Google Sign-In berhasil, lalu melaporkan 2 hal baru + 1 permintaan desain ulang:

- **Order tidak masuk ke driver, walau driver sudah online duluan sesuai arahan sebelumnya** — dikonfirmasi
  bug sungguhan lewat log produksi (bukan lagi soal urutan/timing seperti dugaan awal): driver online
  >5 menit, polling tawaran berjalan normal terus, TAPI **tidak ada satu pun lokasi terkirim** sepanjang
  sesi itu. Root cause: pemeriksaan izin lokasi cuma sekali saat tombol Online ditekan — izin/GPS yang
  hilang SETELAH itu tidak pernah terdeteksi ulang, driver terlihat online tapi sebenarnya tidak terlihat
  sistem pencocokan sama sekali, tanpa peringatan apa pun. Diperbaiki: pemeriksaan berkala sekarang
  memunculkan banner "Buka Pengaturan Lokasi" yang sama seperti saat toggle, dan pulih otomatis begitu
  izin kembali tersedia — tidak perlu toggle ulang.
- **Ikon dirombak total ke gaya seamless seperti user_app** — Opsi "kartu navy dalam bingkai gold" (D4.3)
  masih dinilai terlalu tebal setelah diperbesar ke batas maksimal safe-zone (~0.49, tidak bisa lebih
  besar lagi tanpa melanggar spesifikasi). Dibandingkan langsung dengan ikon user_app dan Owner memilih
  arahnya: satu bidang gold tanpa sambungan, lambang navy langsung di atasnya (gold tetap dominan,
  membedakan dari user_app yang navy-dominan). Teks kecil "DRIVER" (nyaris menempel tepi kanvas di desain
  asli) dipulihkan dengan teknik deteksi sambungan piksel + alpha halus berbasis kecerahan, setelah dua
  percobaan awal kehilangannya.

## Belum tercakup (jujur)
- Tidak ada uji di HP nyata untuk layanan latar depan, push, dan face check. Uji lapangan dua HP (lihat
  `DRIVER_APP_READINESS_PLAN.md`) wajib sebelum produksi.
- Penalti pembatalan driver belum ada (menunggu keputusan bisnis). Gerbang versi minimum untuk driver (D5) belum ada.
- Pemeriksaan visual tema terang/gelap driver_app di emulator belum dilakukan pada tahap ini.
