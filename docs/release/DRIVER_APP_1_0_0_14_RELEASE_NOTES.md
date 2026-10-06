# TapGo Driver 1.0.0+14 — Release Notes

Tanggal: 2026-10-06. Menggantikan 1.0.0+13 (isi +13 tetap berlaku). `versionCode` 14. Pin tetap trust-anchor.
Dasar: uji HP Owner pada +13 ("sudah suka") dan empat penyempurnaan: ikon driver, menu Akun, pilihan bunyi, PPOB.
user_app tidak berubah (tetap 2.0.5+38; ikon penumpang sengaja tidak disentuh).

## 1. Ikon driver dibedakan dari ikon penumpang
Latar **emas** `#FFC857`; lambang perisai singa-T dan huruf T berwarna **navy** `#082140`. Sumber tetap logo
resmi 1280 px (bukan gambar baru). Berlaku pada ikon adaptif (lima densitas), ikon legacy Android 7, ikon Play 512
(`google-play-assets/driver/`), dan warna aksen notifikasi. Lapisan monokrom (Android 13+) dan ikon kecil
notifikasi tidak berubah. `launcher_icon_test.dart` menjaga latar emas, ukuran lambang, dan kelengkapan berkas.

## 2. Menu Akun gaya Gojek (driver saja)
Tab Akun kini daftar berkategori: **profil** (inisial, nama, plat tersamar), pengajuan mitra (hanya bila
relevan), kategori **Pengaturan** (Tampilan, Notifikasi), kategori **Bantuan** (WhatsApp, Kebijakan Privasi),
lalu **Keluar**. Pilihan tema pindah ke halaman Tampilan; ringkasan pilihan terlihat di barisnya.
Kartu "Kendaraan" lama dilebur ke profil.

## 3. Tiga pilihan bunyi (Akun → Notifikasi)
Halaman Notifikasi hanya berisi **tiga baris pilihan**: TapGo, Lonceng, Panggilan. Mengetuk satu baris memilihnya
sekaligus membunyikannya, seperti memilih nada dering. Layar "Uji bunyi" dan tombol-tombol tambahannya **dihapus**
(bukan disembunyikan); banner Beranda "notifikasi dimatikan" tetap ada karena itu satu-satunya petunjuk bila Android
memblokir notifikasi.
- Tiga berkas suara di `res/raw/` (`tapgo_alert`, `tapgo_alert_lonceng`, `tapgo_alert_panggilan`), tiga channel
  (`tapgo_alerts_v3`, `tapgo_alerts_v3_lonceng`, `tapgo_alerts_v3_panggilan`) karena suara channel tidak dapat
  diubah setelah dibuat. Channel `tapgo_alerts_v3` tetap ada sehingga pemasang +13 tidak kehilangan apa pun.
- **Saat aplikasi terbuka**: bunyi pilihan diputar langsung (MediaPlayer) — **tidak bergantung backend**.
- **Saat aplikasi tertutup (FCM)**: aplikasi mengirim bunyi pilihan bersama token (`POST /notifications/push-token`,
  bidang `sound`); backend memilih channel per perangkat dengan daftar putih. **Butuh cutover backend baru**
  (migrasi kolom `push_tokens.sound`). Sebelum cutover, aplikasi tetap bekerja (bidang tak dikenal diabaikan
  server) dan bunyi latar belakang tetap TapGo.
- Pilihan tersimpan di HP (SharedPreferences) dan didaftarkan ulang ke server saat diganti serta saat aplikasi
  dibuka.

## 4. PPOB (Digiflazz)
Analisis dan rencana: `PPOB_PASCABAYAR_DIGIFLAZZ_ANALISIS_RENCANA.md`. Ringkas: API key yang sama berlaku untuk
semua produk (tidak ada kunci PDAM terpisah); yang kurang adalah format pascabayar di kode backend
(`inq-pasca`, `pay-pasca`, `status-pasca`, daftar harga `admin`/`commission`). **Tidak ada kode PPOB yang berubah
di +14**; pembangunan menunggu empat keputusan Owner di dokumen itu.

## Terbukti dan belum terbukti
- Terbukti (tes): tiga bunyi dan tiga channel konsisten antara Dart, Kotlin, dan backend; ketukan baris memilih dan
  membunyikan; token dikirim bersama bunyi dan didaftarkan ulang saat ganti; server tidak menimpa pilihan bila
  APK lama mendaftar ulang; nilai di luar daftar putih ditolak (400) dan jatuh ke channel bawaan.
- **Belum terbukti** (butuh HP): kejelasan tiga bunyi baru di speaker HP, tampilan Akun di layar nyata, warna ikon.
- **Butuh cutover backend**: bunyi pilihan pada notifikasi saat aplikasi tertutup.

## Catatan uji HP (belum dilakukan)
- [ ] Ikon driver di layar utama: latar emas, lambang navy; beda jelas dari ikon penumpang.
- [ ] Akun: profil, kategori Pengaturan dan Bantuan rapi; Tampilan membuka tiga pilihan tema.
- [ ] Akun → Notifikasi: hanya tiga baris; tiap ketukan langsung berbunyi dan tandanya pindah.
- [ ] Order masuk saat aplikasi terbuka berbunyi dengan nada yang dipilih.
- [ ] (Setelah cutover) aplikasi ditutup, order masuk berbunyi dengan nada pilihan.
