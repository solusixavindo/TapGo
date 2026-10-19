# Berkas Play Console siap salin — TapGo Driver 1.0.0 (16)

Disusun 16 Oktober 2026 dari kondisi kode dan produksi yang SUNGGUH berlaku. Semua isian di bawah dicocokkan dengan APK `1.0.0+16`
(izin diperiksa dari APK dengan `aapt2`, bukan dari ingatan). Dokumen ini menggantikan bagian yang usang di
`GOOGLE_PLAY_DRIVER_APP_LISTING_DRAFT.md` dan `DRIVER_APP_PLAY_CONSOLE_OWNER_STEPS.md`; rincian Data Safety ada di
`GOOGLE_PLAY_DRIVER_APP_DATA_SAFETY_MAPPING.md` (sudah diperbarui).

> **Prasyarat teknis (sudah beres):** backend `tapgo-3668799` aktif (Pusat Bantuan, insentif, hapus akun). AAB `+16` sudah DIBANGUN ULANG
> pada 16 Okt 2026 dengan layar **Hapus Akun** di dalam aplikasi (syarat Play) dan lulus gerbang rilis (294 tes, TLS live, anchor, 16 KB).

## 0. Berkas yang diunggah

| Berkas | Lokasi | Catatan |
|---|---|---|
| AAB | `~/Documents/dari DESKTOP/arsip-rilis-tapgo/tapgo-driver-1.0.0+16.aab` | sha256 `132a5f66d67fb5b4c6d2ffe653bf4a66fed20ddd2d8d422aa95dbcc9dd801385` (cocokkan dengan `.sha256` di sebelahnya) |
| File deobfuscation | `.../tapgo-driver-1.0.0+16-mapping.txt` | Unggah di rilis (App bundle explorer / kolom "Deobfuscation file") supaya laporan crash terbaca |
| Simbol native | `.../tapgo-driver-1.0.0+16-native-debug-symbols.zip` | Unggah di tempat yang sama (debug symbols) |
| APK uji | `~/Desktop/tapgo-driver-1.0.0+16.apk` | Hanya untuk uji HP; Play memakai AAB |
| Ikon 512×512 | `google-play-assets/driver/tapgo-driver-icon-512.png` | |
| Feature graphic 1024×500 | `google-play-assets/driver/tapgo-driver-feature-graphic-1024x500.png` | |
| Screenshot HP | dari HP Owner (bagian 3) | minimal 2, disarankan 4–8 |

Paket: `com.xavindo.tapgo.driver` · versi 1.0.0 · versionCode 16 · minSdk 24 · targetSdk 36 · bahasa utama: Indonesia (id-ID).

## 1. Detail toko (Store listing → Main store listing)

**Nama aplikasi** (≤30): `TapGo Driver`

**Deskripsi singkat** (≤80; 72 karakter):
```
Terima order, navigasi rute, dan pantau penghasilan sebagai mitra TapGo.
```

**Deskripsi lengkap** (≤4000; 2325 karakter):
```
TapGo Driver adalah aplikasi resmi mitra pengemudi TapGo dari PT. TapGo Lion Indonesia untuk menerima dan menjalankan pesanan Ojek Online (TapGo Ride) dan Mobil (TapGo Car).

Dengan TapGo Driver, mitra dapat:

• Menerima tawaran pesanan terdekat sesuai posisi dan jenis kendaraan, lengkap dengan hitung mundur, jarak, tarif, dan rincian komisi sebelum menerima.
• Melihat rute jemput dan tujuan, lalu membuka navigasi lewat Google Maps.
• Mengatur status Online/Offline, melihat riwayat perjalanan, dan berkirim pesan dengan penumpang selama perjalanan aktif.
• Memantau Saldo TapGo, komisi, riwayat isi saldo, dan ringkasan pendapatan harian, mingguan, dan bulanan.
• Melihat penilaian dan ulasan dari penumpang, serta menilai penumpang setelah perjalanan selesai.
• Memantau target insentif harian (bila tersedia) dan kemajuan perjalanan Anda.
• Mengajukan dan melengkapi dokumen verifikasi mitra (KTP, SIM, STNK) langsung dari aplikasi.
• Mengirim sinyal darurat (SOS) ke tim TapGo bila terjadi keadaan tidak aman selama bertugas.
• Membuka Pusat Bantuan: pertanyaan umum, kirim pertanyaan ke tim TapGo, dan hubungi dukungan resmi lewat WhatsApp.
• Mengajukan penghapusan akun langsung dari aplikasi.

Lokasi dan layar mati
Selama berstatus Online, aplikasi membagikan lokasi perangkat secara berkala ke sistem TapGo lewat layanan latar depan dengan notifikasi tetap "TapGo Driver aktif", supaya penumpang dan sistem pencocokan dapat melihat posisi Anda dan tawaran tetap sampai saat layar mati. Lokasi berhenti dibagikan segera setelah status diubah menjadi Offline. Aplikasi tidak meminta izin lokasi latar belakang.

Komisi dan penghasilan
Komisi per perjalanan ditampilkan jelas pada setiap tawaran. Pesanan tunai membutuhkan Saldo TapGo yang mencukupi; isi saldo dilakukan lewat situs resmi tapgolion.id. Insentif dan benefit lain mengikuti ketentuan resmi TapGo, status akun, serta validasi perjalanan dan sistem anti-penyalahgunaan. TapGo tidak menjanjikan penghasilan tetap; seluruh penghasilan mitra bergantung pada aktivitas, kelayakan, dan validasi sistem.

Khusus mitra
TapGo Driver ditujukan khusus untuk mitra pengemudi yang mendaftar dan lolos verifikasi dokumen oleh tim TapGo; bukan aplikasi untuk penumpang. Penumpang yang ingin memesan silakan memakai aplikasi TapGo (Penumpang).

Bantuan: support@tapgolion.id
```

**Yang baru** (≤500; 283 karakter), untuk kolom "Release notes" saat membuat rilis:
```
Rilis pertama TapGo Driver.
• Terima tawaran pesanan dengan hitung mundur dan rincian komisi
• Navigasi ke titik jemput dan tujuan
• Pendapatan, Saldo TapGo, dan riwayat saldo
• Penilaian penumpang, insentif harian, dan Pusat Bantuan
• Tombol SOS dan pengajuan hapus akun di aplikasi
```

Kategori: **Maps & Navigation** (alternatif: Business). Tag: pilih yang paling dekat dengan "ride hailing / transportation" bila ada.
Email kontak: `support@tapgolion.id` · Situs: `https://tapgolion.id` · Kebijakan privasi: `https://tapgolion.id/privacy-policy`.

Nada yang dipakai: tanpa klaim penghasilan pasti, tanpa angka komisi/insentif di listing (agar tidak usang bila tarif berubah), dan tanpa
janji verifikasi wajah (fitur itu belum diwajibkan di produksi; `DRIVER_FACE_CHECK_ENABLED` tidak diset).

## 2. Konten aplikasi (Policy → App content) — jawaban per formulir

| Formulir | Jawaban | Dasar |
|---|---|---|
| Kebijakan privasi | `https://tapgolion.id/privacy-policy` | Bagian TapGo Driver sudah diperbarui (jejak lokasi 14 hari, penilaian, insentif, Pusat Bantuan, hapus akun). **Zip landing `tapgolion-hostinger-upload-privasi-driver.zip` harus diunggah ke Hostinger SEBELUM mengirim ke review.** |
| Akses aplikasi | **Dibatasi** (butuh login) — isi kredensial reviewer (bagian 5) | Aplikasi khusus mitra |
| Iklan | **Tidak ada iklan** | Tidak ada SDK iklan; izin `AD_ID` tidak ada di APK |
| Peringkat konten (IARC) | Kategori "Utilitas / Produktivitas / Lainnya". Kekerasan, seksual, bahasa kasar, narkoba, judi: **Tidak**. "Pengguna dapat berinteraksi/bertukar konten": **Ya** (chat dengan penumpang). "Membagikan lokasi": **Ya**. Pembelian digital dalam aplikasi: **Tidak** | Hasil yang wajar: usia 3+ dengan label interaksi pengguna dan berbagi lokasi |
| Target audiens | **18 tahun ke atas saja**; bukan untuk anak-anak | Mitra pengemudi dewasa |
| Aplikasi berita / COVID / kesehatan / pemerintah | **Bukan** semuanya | |
| Fitur keuangan | Aplikasi hanya MENAMPILKAN Saldo TapGo dan riwayatnya; isi saldo dan penarikan dilakukan di situs, bukan di aplikasi. Jawab sesuai pilihan yang tampil di formulir; bila ada opsi dompet/pembayaran yang paling mendekati "saldo internal", pilih itu dan jelaskan bahwa transaksi uang tidak diproses di aplikasi | Formulir Play berubah-ubah, jangan menebak kategori pinjaman/kripto |
| ID iklan | **Tidak memakai** | |
| Keamanan data | Salin dari `GOOGLE_PLAY_DRIVER_APP_DATA_SAFETY_MAPPING.md` baris demi baris | Sudah mencakup pesan, konten pengguna, lokasi (14 hari), ID perangkat |
| Penghapusan data | Ada jalur di aplikasi (**Akun > Bantuan > Hapus Akun**) dan tautan web `https://tapgolion.id/hapus-akun` | Isi tautan web itu di kolom "Delete account URL" |

### Deklarasi izin sensitif
- **Lokasi latar belakang:** **TIDAK ada** (tidak diminta; formulir tidak perlu diisi).
- **Layanan latar depan (foreground service) tipe Location:** wajib; lihat bagian 4 (butuh VIDEO).
- **Foto dan video:** hanya `READ_EXTERNAL_STORAGE` (maks. Android 12L) untuk memilih foto dokumen lewat pemilih sistem; tanpa `READ_MEDIA_*`. Tidak perlu deklarasi izin foto/video.
- **Kamera:** memotret dokumen mitra (dan verifikasi wajah bila diwajibkan). Tidak merekam suara (`RECORD_AUDIO` dibuang).
- **Layar penuh (full-screen intent), alarm tepat, akses semua berkas:** tidak dipakai.

## 3. Screenshot (dari HP Owner)

Syarat: PNG/JPEG, tiap sisi 320–3840 px, rasio maksimal 2:1 (disarankan 1080×1920 atau lebih). Gunakan akun uji driver yang datanya terlihat
wajar. Urutan yang disarankan:

1. **Beranda** — status Online, kartu ringkasan hari ini.
2. **Tawaran masuk** — kartu dengan jarak, tarif, hitung mundur, dan rincian komisi.
3. **Perjalanan aktif** — peta dengan posisi, tombol aksi dan chat.
4. **Pendapatan** — ringkasan harian, Saldo TapGo, kartu Performa dengan penilaian.
5. **Insentif hari ini** — kartu insentif (buat dulu satu aturan kecil di konsol) atau layar **Penilaian penumpang**.
6. **Akun > Pusat Bantuan** — pertanyaan umum.

Jangan tampilkan nomor HP, plat nomor utuh, atau data orang sungguhan. Ambil di tema terang; tema gelap opsional.

## 4. Deklarasi layanan latar depan (Location) — teks dan VIDEO

Play meminta (a) penjelasan dan (b) **video** pendek yang memperlihatkan fitur yang memakai layanan itu.

**Penjelasan (salin):**
```
TapGo Driver adalah aplikasi mitra pengemudi ojek/mobil online. Saat driver menekan "Online", aplikasi menjalankan layanan latar depan bertipe
location dengan notifikasi tetap "TapGo Driver aktif" agar posisi driver tetap dikirim ke sistem pencocokan pesanan dan ke penumpang yang sedang
dijemput walaupun layar terkunci atau aplikasi berada di latar. Layanan berhenti seketika saat driver menekan "Offline" atau perjalanan
selesai dan driver offline. Aplikasi tidak memakai izin lokasi latar belakang; lokasi hanya dikirim selama layanan latar depan aktif.
```

**Naskah video (45–60 detik, rekam layar HP + suara/teks bebas):**
1. Buka aplikasi, tunjukkan izin lokasi diminta saat pertama kali menekan Online (izinkan "Saat aplikasi digunakan").
2. Tekan **Online**: tunjukkan notifikasi tetap "TapGo Driver aktif" di bayangan notifikasi.
3. Kunci layar 10 detik, buka lagi: notifikasi masih ada; tunjukkan di HP kedua (penumpang) bahwa posisi driver bergerak / tawaran sampai.
4. Tekan **Offline**: notifikasi hilang.
Unggah ke YouTube sebagai **Tidak publik (unlisted)**, tempel tautannya di formulir.

## 5. Akun reviewer (App access)

Di VPS (backend sudah memuat skrip `driver:reviewer-bootstrap`):
```bash
cd /var/www/releases/tapgo-3668799/apps/backend
read -s TAPGO_REVIEWER_PASSWORD && export TAPGO_REVIEWER_PASSWORD
npm run driver:reviewer-bootstrap -- --phone 08XXXXXXXXXX --full-name "Google Play Reviewer" --confirm-reviewer-bootstrap
```
Pakai nomor HP KHUSUS (bukan pribadi). Akun ini sengaja tanpa kendaraan terverifikasi: bisa menjelajah semua tab dan menekan Online,
tetapi tidak pernah menerima pesanan sungguhan. Karena komisi menyala, reviewer tidak perlu saldo untuk melihat layar apa pun.

**Instruksi untuk reviewer (salin ke kolom "Instructions"):**
```
Masuk dengan nomor HP dan password yang diberikan (kolom Username/Password). Aplikasi ini khusus mitra pengemudi TapGo yang sudah
terverifikasi. Akun uji dapat membuka semua tab (Beranda, Pesanan, Pendapatan, Akun), menekan Online/Offline, membuka Pusat Bantuan,
Penilaian penumpang, dan layar Hapus Akun (Akun > Bantuan). Akun ini sengaja tidak memiliki kendaraan terverifikasi sehingga tidak akan
menerima pesanan sungguhan; ini untuk melindungi penumpang asli selama review. Izin lokasi diperlukan untuk status Online. Kartu "Pengajuan Mitra" di tab Akun bersifat opsional (alur pendaftaran mitra baru) dan tidak perlu diisi untuk menilai aplikasi.
```
Jangan menulis nomor/password di berkas repo. Setelah review, akun boleh dibiarkan atau dinonaktifkan.

## 6. Google Cloud: publikasikan OAuth consent screen (project `tapgo-c7cb3`)
Tanpa ini, Login dengan Google hanya jalan untuk daftar test user dan **gagal untuk driver umum**. Langkah rinci ada di
`DRIVER_APP_PLAY_CONSOLE_OWNER_STEPS.md` bagian "Langkah 5". Kerjakan SEBELUM rilis produksi.

## 7. Urutan kerja Owner (centang satu per satu)
1. [x] AAB (+16) dibangun ulang dengan layar Hapus Akun, gerbang rilis lolos. *(selesai)*
2. [ ] Unggah zip landing `tapgolion-hostinger-upload-privasi-driver.zip` ke Hostinger dan cek `/privacy-policy` dan `/hapus-akun`.
3. [ ] Buat akun reviewer (bagian 5).
4. [ ] Ambil screenshot dan rekam video layanan latar depan (bagian 3–4).
5. [ ] Play Console: buat aplikasi → isi Store listing (bagian 1) → App content (bagian 2) → Data safety → deklarasi foreground service + video.
6. [ ] Publikasikan OAuth consent screen (bagian 6).
7. [ ] Production → Create release → unggah AAB → tempel "Yang baru" → **rilis bertahap 20%** → kirim review.
8. [ ] Setelah disetujui: pantau 2–3 hari (Android vitals: crash/ANR, Sentry, kanal dukungan), naikkan bertahap ke 50% lalu 100%. Bila ada lonjakan crash, **Halt rollout**.

Catatan hukum yang belum dikerjakan: Pernyataan Kemitraan (10 bagian) belum ditinjau penasihat hukum.
