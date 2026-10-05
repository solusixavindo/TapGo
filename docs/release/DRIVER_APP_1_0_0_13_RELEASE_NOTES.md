# TapGo Driver 1.0.0+13 — Release Notes

Tanggal: 2026-10-06. Menggantikan 1.0.0+12 (isi +12 tetap berlaku). `versionCode` 13. Pin tetap trust-anchor.
Dasar: uji HP Owner pada +12 (bunyi, chat, ikon) dan permintaan peningkatan performa.

## Akar masalah dan perbaikan

### 1. Bunyi (butir 1)
**Terbukti:** channel notifikasi yang sudah dibuat di HP (`tapgo_default` oleh APK lama, lalu
`tapgo_alerts_v2` oleh +11/+12) tidak dapat diubah suaranya oleh pemasangan baru (Android 8+); dan nada
bawaan HP bisa "Tanpa suara". **Tidak terbukti** (tanpa HP): apa yang tepatnya menahan bunyi di HP Anda, karena
itu +13 menambah alat pembuktian.
- **Berkas suara bawaan aplikasi** (`res/raw/tapgo_alert.wav`, tiga nada naik diulang, ±1,9 detik) untuk
  channel baru **`tapgo_alerts_v3`** dan untuk pemutaran saat aplikasi di depan (MediaPlayer, tetap
  `USAGE_NOTIFICATION`: HP senyap/Jangan Ganggu tetap senyap). Tidak lagi bergantung pada nada bawaan HP.
- **Layar "Uji bunyi"** (tab Akun → Notifikasi → Uji bunyi): memutar bunyi dan menampilkan izin notifikasi,
  kategori "Peringatan TapGo", mode dering, volume notifikasi, Jangan Ganggu, dan nada bawaan, masing-masing
  hijau/kuning/merah dengan tindakan perbaikan; tombol "Salin laporan" untuk dikirim ke tim.
- **Banner Beranda** bila notifikasi dimatikan di Android, dengan tombol ke pengaturan.
- Satu peristiwa = satu bunyi dan aturan sebelumnya (chat terbuka senyap, sekali per referensi order) tetap.

### 2. Pesan chat masuk (butir 2)
**Terbukti:** satu-satunya pemicu popup adalah push FCM; tanpa FCM tidak ada tanda apa pun.
- **Pemantau kotak masuk chat** (`GET /chat/conversations`, sudah ada di produksi) tiap 6 detik selama ada
  perjalanan aktif: jumlah belum dibaca naik → popup + satu bunyi, **tanpa FCM**. FCM tetap mempercepat;
  penjaga 8 detik mencegah peringatan ganda.
- **Titik merah menetap** pada tab Pesanan dan tombol "Chat dengan Penumpang (pesan baru)" sampai dibaca.

### 5. Ikon besar (butir 5)
**Terbukti (terukur):** gambar hanya 48% lebar kanvas adaptif, bergaris halus, di atas latar emas.
- Lambang **perisai singa-T resmi** (dari logo 1280 px; bukan gambar baru) emas di atas **latar navy**
  `#082140`, mengisi ≥ 57% lebar kanvas (hampir seluruh area terlihat). Lapisan **monokrom** untuk ikon bertema
  Android 13+, ikon legacy Android 7 baru, ikon Play 512 baru (`google-play-assets/driver/`), dan **ikon kecil
  notifikasi** siluet putih (`ic_stat_tapgo`; sebelumnya ikon peluncur berwarna tampil sebagai gumpalan putih).
- Tes `launcher_icon_test.dart` menjaga ukuran logo (≥ 55% dan ≤ 70% kanvas) dan kelengkapan berkas.

### 6. Performa (diukur, bukan klaim)
| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Rebuild elemen pada 3 poll tanpa perubahan data, Beranda | **1135** | **0** |
| Sama, tab Pesanan dengan 2 tawaran | **1134** | **0** |
| Muat penawaran + availability (2 permintaan) | berurutan (jumlah dua latensi) | **bersamaan** (diuji: cukup ±1 latensi) |
| Selang polling di latar belakang (driver Online) | 12 dtk | **30 dtk** (di depan tetap 12 dtk) |

Penyebab: poll membuat objek state baru bernilai sama dan `StateNotifier` memberi tahu pendengar bila
*identitas* berbeda, sementara seluruh cangkang dan layar menonton seluruh state. Perbaikan: kesetaraan nilai
pada `DriverState`/`DriverRide`/`DriverSession` + `updateShouldNotify`, cangkang hanya menonton bidang yang
dipakainya, `Future.wait`, dan polling adaptif. Data yang benar-benar berubah tetap memperbarui layar (diuji).
**Belum diukur di HP:** waktu mulai dingin, baterai, dan penggunaan data (butuh perangkat); angka di atas
berasal dari tes widget. Tidak ada perubahan pada Sentry init (tidak terbukti perlu).

## Bergantung pada backend (rilis terpisah)
- Bunyi notifikasi **latar belakang (FCM)**: `channel_id` produksi masih `tapgo_default`. Branch
  `release/driver-rating` membawa `tapgo_alerts_v3`; sampai cutover, bunyi latar belakang tetap di channel lama.
- Bunyi saat aplikasi **terbuka**, chat tanpa FCM, ikon, dan performa **tidak** bergantung pada backend.

## Catatan uji HP (belum dilakukan)
- [ ] Akun → Uji bunyi: semua hijau? Terdengar? Bila tidak, tekan "Salin laporan" dan kirim isinya.
- [ ] Order masuk saat aplikasi terbuka: berbunyi sekali (nada tiga nada TapGo).
- [ ] Penumpang mengirim chat saat layar chat tertutup: popup + bunyi + titik merah di tab Pesanan dan tombol
      chat; **tanpa bergantung FCM** (uji juga dengan data seluler dimatikan lalu dinyalakan).
- [ ] Ikon di layar utama besar dan jelas (lingkaran/kotak membulat); aktifkan ikon bertema (Android 13+).
- [ ] Notifikasi muncul dengan ikon perisai putih di bilah status.
- [ ] Beranda terasa lebih ringan saat Online lama; baterai lebih hemat di latar belakang.

## Yang belum dilakukan
Belum ada uji HP. Dokumen ini tidak menyatakan driver_app siap 100%.
