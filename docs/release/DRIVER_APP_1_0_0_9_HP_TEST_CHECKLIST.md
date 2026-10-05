# Daftar uji HP — TapGo driver 1.0.0+9

Tujuan: membuktikan di perangkat nyata lima perbaikan dari uji HP driver +7 (status beranda, peta
beranda, tombol sampai tujuan, pemberitahuan tolak tawaran, dialog SOS) plus ikon baru, dan memastikan
koneksi ke server produksi tetap berfungsi. Dokumen ini **belum berisi hasil uji HP**; belum ada uji HP
untuk build ini. Yang sudah dibuktikan di luar HP: tes otomatis (driver 185, user_app 379, backend 1267
lolos), gerbang rilis dengan handshake nyata ke `api.tapgolion.id`, dan pemeriksaan artefak.

- Berkas: `tapgo-driver-1.0.0+9.apk` (versionCode 9, versionName 1.0.0, package `com.xavindo.tapgo.driver`)
- SHA-256 APK: `27e6f6b6232dcdf446de3f7219bc923fd96348edf0d20a0b43bf6d5e37379ca4`
- Tanda tangan sama dengan driver +8, sehingga menimpa pemasangan +8 tanpa menghapus data.
- **Driver +4 sampai +7 tidak boleh dipakai** (tidak dapat terhubung; lihat `TLS_TRUST_ANCHORS.md`).
- Server: produksi (`api.tapgolion.id`).

## Peringatan penting: status backend produksi

Backend produksi **belum memuat** `GET /driver/availability` dan push "pencarian dilanjutkan" (commit
backend `d7e821d` belum dirilis; rilis backend adalah tindakan Owner). Karena itu uji dibagi dua:

- **Mode A — backend produksi apa adanya (sekarang).** Bagian 1 s.d. 4 dan 6 berlaku. Bagian 2 (status
  mengikuti server) dan 5 (push penumpang) akan menunjukkan perilaku *fallback*, bukan perbaikan penuh.
  Itu **bukan bug**; catat sebagai "Mode A".
- **Mode B — setelah backend dirilis.** Ulangi bagian 2 dan 5 untuk membuktikan perbaikan penuh.
  Jangan menyatakan perbaikan 1 dan 4 lulus sebelum Mode B diuji.

Cek mode: bila `GET /driver/availability` belum ada, server membalas `ROUTE_NOT_FOUND`/404 (aplikasi
tidak menampilkan galat; ia mempertahankan status terakhirnya).

## 0. Persiapan

- [ ] **2 HP**: HP driver (+9) dan HP penumpang (user_app +34 atau +35). Untuk bagian 5 sebaiknya
      penumpang memakai **+35** (baris "Seorang driver tidak mengambil pesanan" hanya ada di +35).
- [ ] Akun driver uji **milik sendiri** yang aktif dan lolos verifikasi, serta akun penumpang uji dengan
      saldo kecil. Jangan memakai akun pelanggan.
- [ ] Idealnya **2 akun driver** (untuk uji "driver lain sudah menerima" di bagian 5).
- [ ] Cocokkan checksum: `shasum -a 256 tapgo-driver-1.0.0+9.apk`.
- [ ] Pasang. Pengaturan Android → Aplikasi → TapGo Driver: versi 1.0.0.
- [ ] Izin lokasi (saat aplikasi dipakai) dan notifikasi diberikan. GPS menyala.
- [ ] Tes di luar ruangan atau dekat jendela agar GPS stabil.

## 1. Koneksi dan login (regresi pinning TLS)

Pesan yang BUKAN lulus saat jaringan normal: "Perbarui aplikasi dari Google Play…", "belum dikonfigurasi
dengan benar", "Periksa tanggal dan jam HP Anda…". Hentikan uji, screenshot, catat jaringan.

- [ ] 1.1 Login dengan password **sengaja salah**: tetap di form login, pesan berbahasa Indonesia.
- [ ] 1.2 Login benar di Wi-Fi: masuk ke beranda.
- [ ] 1.3 Matikan Wi-Fi (data seluler), tutup paksa, buka lagi: sesi pulih dan beranda termuat.
- [ ] 1.4 Mode pesawat lalu buka aplikasi: pesan jaringan biasa, tidak crash, tidak ada pesan TLS.
- [ ] 1.5 Matikan mode pesawat tanpa menutup aplikasi: pulih sendiri dalam beberapa detik (polling).

## 2. Status beranda mengikuti server (perbaikan 1)

Kartu status di beranda menampilkan **Online** atau **Offline**; saat ada perjalanan aktif menampilkan
label perjalanan (Menuju Jemput, Tiba di Jemput, Dalam Perjalanan).

**Mode B** (backend sudah dirilis) — bukti perbaikan penuh:

- [ ] 2.1 Driver ONLINE, tutup paksa aplikasi, buka lagi: kartu menampilkan **Online**, pelacakan lokasi
      menyala (titik biru/marker bergerak, indikator pelacakan aktif).
- [ ] 2.2 Driver OFFLINE (matikan toggle), tutup paksa, buka lagi: **Offline**, pelacakan berhenti.
- [ ] 2.3 Buka ulang berkali-kali saat Online: **waktu online (onlineSince) tidak berulang dari nol** dan
      verifikasi wajah tidak diminta ulang hanya karena aplikasi dibuka. (Aplikasi tidak boleh mengirim
      ulang status Online saat dibuka.)
- [ ] 2.4 Setelah menyelesaikan satu perjalanan (bagian 3): kartu **kembali Online** (atau Offline bila
      memang offline di server). Kartu **tidak tertahan "Dalam Perjalanan"**.
- [ ] 2.5 Ganti status dari konsol admin/HP lain bila memungkinkan, lalu tarik refresh/tunggu polling:
      kartu mengikuti server.
- [ ] 2.6 Driver sedang punya perjalanan aktif lalu aplikasi ditutup dan dibuka: kartu menampilkan label
      perjalanan, bukan Online/Offline.

**Mode A** (backend lama) — hanya periksa tidak ada kerusakan:

- [ ] 2.7 Toggle Online/Offline tetap berfungsi; tidak ada pesan galat merah saat aplikasi dibuka.
- [ ] 2.8 Setelah perjalanan selesai/batal, kartu kembali ke Online (fallback), tidak tertahan di label
      perjalanan.

## 3. Alur perjalanan dan tombol akhir (perbaikan 3)

Gunakan penumpang HP kedua; pesan perjalanan tunai nominal kecil.

- [ ] 3.1 Tawaran muncul sebagai popup, diterima. Tombol utama berurutan: "Mulai Menuju Jemput" →
      "Saya Sudah Tiba" → "Mulai Perjalanan" → **"Selesaikan Perjalanan"**.
- [ ] 3.2 Menuju tujuan dan **tiba di titik tujuan** (atau mendekat ≤ puluhan meter dari tujuan):
      perjalanan **tidak selesai sendiri**. Status tetap "Dalam Perjalanan" dan tombol tetap
      "Selesaikan Perjalanan". Tunggu ± 1–2 menit di tujuan untuk memastikan.
- [ ] 3.3 Tekan "Selesaikan Perjalanan": perjalanan selesai, struk/riwayat tampil, saldo/penghasilan
      tercatat.
- [ ] 3.4 Di HP penumpang: status selesai muncul setelah driver menekan tombol (bukan sebelumnya).
- [ ] 3.5 Perjalanan kedua dibatalkan oleh driver atau penumpang: kartu beranda kembali normal.
- [ ] 3.6 Chat driver–penumpang kedua arah saat perjalanan berjalan.

## 4. Peta beranda (perbaikan 2)

- [ ] 4.1 Tutup paksa aplikasi dan buka (driver Online, GPS menyala, berada di lokasi nyata): peta beranda
      **langsung menampilkan posisi Anda** tanpa menunggu bergerak. Bukan Jakarta/lokasi lain.
- [ ] 4.2 Berjalan/berkendara pelan: marker dan kamera mengikuti **tanpa perlu menempuh 10 meter**
      lebih dulu; tidak melompat-lompat.
- [ ] 4.3 Pindah tab lalu kembali ke beranda: peta tetap di posisi Anda.
- [ ] 4.4 Matikan GPS lalu buka aplikasi: peta tampil di Jakarta **tanpa marker**, tidak crash; hidupkan
      GPS lagi: peta pindah ke posisi Anda sendiri.
- [ ] 4.5 Tolak izin lokasi (Pengaturan → Izin): pesan yang jelas dan tidak crash. Beri izin lagi setelahnya.
- [ ] 4.6 Mode gelap dan terang: peta dan marker terbaca di keduanya.

## 5. Tolak tawaran dan pemberitahuan penumpang (perbaikan 4)

Penumpang HP kedua (+35 di depan, lalu +35 di latar belakang). Pesanan masih mencari driver.

**Mode B** (backend sudah dirilis):

- [ ] 5.1 Penumpang memesan; popup tawaran muncul di HP driver. Driver menekan **Tolak**.
- [ ] 5.2 HP penumpang (aplikasi **di depan**, layar status): di kartu mencari driver muncul satu baris
      "Seorang driver tidak mengambil pesanan. Pencarian dilanjutkan." Status tetap **"Mencari driver"**
      (tidak berubah menjadi batal/tidak ada driver).
- [ ] 5.3 Ulangi dengan aplikasi penumpang **di latar belakang**: notifikasi push muncul dengan judul
      "Masih mencari driver" dan isi yang sama.
- [ ] 5.4 Mengetuk notifikasi membuka layar status perjalanan yang benar.
- [ ] 5.5 Driver yang sama menolak lagi order itu (bila tawaran muncul lagi): **tidak** ada notifikasi kedua.
- [ ] 5.6 Dengan 2 driver: driver A menolak setelah driver B sudah menerima: penumpang **tidak** menerima
      pemberitahuan "pencarian dilanjutkan".
- [ ] 5.7 Order tetap diteruskan ke driver lain/mencari terus; tidak otomatis batal.

**Mode A** (backend lama):

- [ ] 5.8 Menolak tawaran tetap berfungsi tanpa galat; penumpang tidak mendapat push baru (wajar).

## 6. Dialog SOS (perbaikan 5)

- [ ] 6.1 Buka SOS (tombol SOS di aplikasi). Dialog menampilkan **satu judul** ("Kirim sinyal darurat?"),
      **tidak** ada tulisan "SOS Kirim SOS" ganda.
- [ ] 6.2 Tiga tombol **selebar dialog, ditumpuk**: Batal, WhatsApp CS, Kirim SOS (merah, tanpa ikon
      huruf "SOS"). "Batal" **tidak** terbungkus ke baris terpisah yang janggal.
- [ ] 6.3 Periksa dengan **teks besar** (ukuran font maksimum) dan layar kecil: tombol tetap terbaca, dialog
      dapat di-scroll, tidak ada overflow kuning-hitam.
- [ ] 6.4 Mode gelap dan terang terbaca.
- [ ] 6.5 "Batal" menutup dialog tanpa mengirim apa pun.
- [ ] 6.6 "WhatsApp CS" membuka WhatsApp ke nomor CS TapGo.
- [ ] 6.7 **Kirim SOS: jangan sungguh dikirim ke kontak darurat tanpa memberi tahu CS dulu.** Tekan hanya
      bila Anda sudah menyiapkan akun uji dan memberi tahu pihak yang menerima. Karena endpoint SOS
      **belum ada di backend produksi**, hasil yang wajar saat ini adalah pesan galat jelas berbahasa
      Indonesia dengan jalur WhatsApp CS tetap tersedia, tombol tidak macet pada "mengirim", dan tidak
      crash. Catat pesan persisnya.

## 7. Ikon (perbaikan 6)

- [ ] 7.1 Ikon di launcher: latar kuning, lambang singa-T besar, **satu mobil**, **tanpa tulisan**
      TAPGO/DRIVER.
- [ ] 7.2 Bentuk lingkaran, kotak membulat, dan squircle (ganti ikon di pengaturan launcher bila ada):
      singa dan mobil **tidak terpotong** pada bentuk mana pun.
- [ ] 7.3 Ikon bertema (Android 13+ "themed icons") bila diaktifkan: tetap dikenali, tidak kosong.
- [ ] 7.4 Ikon di daftar aplikasi terbaru (recent apps) dan di notifikasi tidak rusak.
- [ ] 7.5 Aplikasi **penumpang** tidak berubah ikonnya.

## 8. Ketahanan dan regresi

- [ ] 8.1 Putar layar dan teks besar: tidak ada overflow atau crash di beranda, tawaran, perjalanan.
- [ ] 8.2 Beberapa tawaran datang bersamaan: dibuka berurutan, tidak ada yang hilang.
- [ ] 8.3 Aplikasi di latar belakang ≥ 30 menit lalu dibuka: sesi sah atau login ulang yang wajar;
      pelacakan lokasi saat Online tetap berjalan sesuai desain.
- [ ] 8.4 Pindah Wi-Fi ↔ data saat berjalan: tidak ada pesan TLS dan polling pulih.
- [ ] 8.5 Mode gelap/terang bolak-balik enam kali: tidak ada "Terjadi gangguan tampilan".
- [ ] 8.6 Dokumen, riwayat, penghasilan, profil, dan tab Pesanan terbuka tanpa galat.
- [ ] 8.7 Logout lalu login ulang: kartu status benar (bagian 2) dan pelacakan sesuai.

## 9. Pencatatan hasil

Salin baris untuk setiap temuan. Tulis **Mode A atau B** pada bagian 2 dan 5.

| No. uji | Mode (A/B) | Hasil (Lulus/Gagal) | HP/versi Android/jaringan | Catatan | Screenshot |
|---|---|---|---|---|---|
| | | | | | |

## 10. Kriteria

- Dinyatakan layak diuji lebih lanjut bila: bagian 1, 3, 4, 6.1–6.6, dan 7 lulus tanpa crash dan tanpa
  pesan TLS pada jaringan normal.
- **Perbaikan 1 (status mengikuti server) dan 4 (pemberitahuan penumpang) hanya boleh dinyatakan terbukti
  setelah bagian 2 dan 5 lulus dalam Mode B**, yaitu setelah backend dirilis Owner.
- Temuan baru wajib masuk `REGRESSION_REGISTER.md` sebelum paket berikutnya diserahkan.
- Dokumen ini tidak menyatakan driver_app siap 100%. Uji lapangan 2 HP, closed testing, dan Play Console
  tetap tindakan Owner.
