# Rencana penyempurnaan driver_app agar siap 100% dipakai driver

Tanggal: 2026-09-26. Dasar: audit langsung terhadap kode driver_app, backend rides, dan uji build.
Aturan tetap: setiap laporan/temuan masuk `REGRESSION_REGISTER.md` beserta ujinya; paket hanya diserahkan
lewat gerbang rilis (skrip khusus driver dibuat di tahap D1); tanpa perubahan warna/font/ikon tanpa izin Owner.

## Kondisi sekarang (temuan audit)
| # | Temuan | Bukti | Dampak |
|---|---|---|---|
| 1 | **Tidak bisa dibangun rilis**: `tflite_flutter` gagal (JVM target Java 1.8 vs Kotlin 21) dan kunci penandatangan belum ada | `flutter build apk --release`: "Release signing is not configured", lalu `compileReleaseKotlin` gagal | Tidak ada APK/AAB driver yang bisa diserahkan |
| 2 | **Tawaran pesanan bersifat global**: driver ONLINE melihat SEMUA pesanan `SEARCHING_DRIVER` sejenis kendaraan, tanpa jarak | `RideService.listOffersForDriver` (tanpa filter lokasi) | Driver di kota A melihat pesanan kota B |
| 3 | **Pesanan tidak pernah kedaluwarsa** | Tidak ada pekerjaan berkala; status SEARCHING bertahan sampai penumpang membatalkan | Tawaran basi, penumpang menunggu tanpa batas |
| 4 | **Berhenti bekerja saat layar mati atau pindah aplikasi**: polling 12 dtk dan lokasi 5 dtk dihentikan saat `paused/inactive` | `driver_controller.dart` (siklus hidup) | Tidak ada tawaran, penumpang tidak melihat posisi driver |
| 5 | **Tanpa notifikasi push dan tanpa layanan latar depan** | Manifest hanya INTERNET, CAMERA, lokasi | Driver harus menatap layar agar tidak ketinggalan pesanan |
| 6 | **Komisi 8% pesanan tunai belum dipotong** dan jalur isi saldo driver belum ada | Catatan desain 2026-09-19; pembayaran DIGITAL fail-closed | Platform belum mendapat pendapatan; keputusan bisnis diperlukan |
| 7 | Versi masih `1.0.0+2`; belum ada gerbang versi minimum untuk driver | pubspec; gerbang server hanya untuk klien yang mengirim header platform | Driver lama tidak bisa dipaksa memperbarui |
| 8 | Yang sudah baik | Analisis bersih, 91 uji lolos, alur pendaftaran, dokumen, face check, pendapatan, riwayat, chat, pemindai admin/Founder | Fondasi kuat |

## Tahap dan urutan
### D1. Bisa dibangun dan diserahkan (pemblokir teknis) — ukuran S-M
1. Perbaiki `tflite_flutter` (samakan JVM target lewat konfigurasi Gradle atau naikkan versi plugin), dibuktikan dengan build rilis nyata.
2. Kunci penandatangan driver (`key.properties`) dan konfigurasi rilis; **keputusan Owner**: kunci baru atau kunci yang sama dengan user_app.
3. `scripts/release-gate-driver-app.sh` (pola sama dengan user_app: sumber, analisis, uji, build APK/AAB, pemindai artefak, cek versionCode/izin) dan langkah build rilis di CI.
4. Naikkan versi ke 2.0.0+1 (tanda rilis besar pertama) atau sesuai keputusan Owner.
Selesai bila: `GERBANG LOLOS` menghasilkan APK dan AAB bertanda tangan.

### D2. Pencocokan pesanan yang benar (backend) — ukuran M
1. Tawaran berbasis jarak: hanya pesanan dalam radius dari posisi terakhir driver (bawaan 5 km, dapat diatur), diurutkan terdekat, dengan jarak ke titik jemput; wajib ada posisi segar (≤60 dtk) untuk menerima tawaran.
2. Batas waktu pencarian: pesanan `SEARCHING_DRIVER` tanpa driver lewat 3 menit otomatis menjadi tidak ada driver (dibatalkan sistem), penumpang diberi tahu, tawaran basi hilang.
3. Uji integrasi: radius, urutan, posisi basi, kedaluwarsa, dan tidak ada regresi pada alur terima/tolak.
Selesai bila: semua uji lolos, dan uji dua HP menunjukkan driver jauh tidak melihat pesanan.

### D3. Tetap menerima pesanan saat layar mati — ukuran L
1. **Layanan latar depan** (izin `FOREGROUND_SERVICE` dan `FOREGROUND_SERVICE_LOCATION`, notifikasi tetap "Anda online") agar lokasi dan polling tetap berjalan; berhenti otomatis saat driver offline.
2. **Firebase untuk driver_app** (butuh `google-services.json` untuk `com.xavindo.tapgo.driver`), token didaftarkan ke endpoint yang sudah ada.
3. **Push tawaran baru**: backend mengirim ke driver ONLINE dalam radius saat pesanan dibuat (kanal berprioritas tinggi, ketuk membuka tawaran); push pembatalan oleh penumpang dan pesan chat.
4. Deklarasi Play: Foreground service (lokasi) dan kebijakan lokasi; teks kebijakan privasi driver diperbarui.
Selesai bila: dengan layar mati, HP driver berbunyi dan tawaran terbuka; posisi tetap terlihat di HP penumpang.

### D4. Alur kerja driver tuntas — ukuran M
1. Kartu tawaran: jarak, tarif, hitung mundur, tolak/terima, dan tombol navigasi ke Google Maps (titik jemput dan tujuan).
2. Pembatalan oleh driver: alasan yang jelas dan dampaknya (keputusan penalti dari Owner).
3. Pendapatan: angka dicocokkan dengan backend, ringkasan harian/mingguan, dan **komisi** sesuai keputusan bisnis (lihat keputusan 2).
4. Face check harian dan dokumen: uji di perangkat nyata (cahaya kurang, kamera lambat), pesan galat yang jelas, jalur override admin.
5. Tema terang dan gelap, tampilan ganti tema bolak-balik, dan pemeriksaan visual di emulator/HP.
Selesai bila: satu perjalanan penuh (terima, jemput, mulai, selesai) berjalan mulus dua kali berturut-turut di HP nyata.

### D5. Persiapan Play dan uji lapangan — ukuran M
1. Gerbang versi minimum untuk driver (header platform di aplikasi driver dan aturan server terpisah dari user_app).
2. Data safety, kebijakan privasi driver, akun uji untuk reviewer (driver berstatus ACTIVE), dan deklarasi lain.
3. **Closed testing** dengan 5-10 driver pilot dan 2 penumpang, minimal satu minggu, dengan daftar uji harian.
4. Baru setelah lolos: rilis produksi bertahap (misalnya 20% lalu 100%).

## Uji lapangan wajib (dua HP: penumpang dan driver)
1. Pesan ojek → driver di dalam radius menerima push, driver di luar radius tidak.
2. Layar driver mati saat tawaran masuk → tetap berbunyi dan terbuka dengan satu ketukan.
3. Terima → jemput → tiba → mulai → selesai; posisi bergerak di peta penumpang.
4. Chat dua arah (notifikasi, lencana, balasan cepat).
5. Pembatalan oleh driver dan penumpang di tiap tahap.
6. Tidak ada driver: pesanan kedaluwarsa dalam 3 menit dan penumpang diberi tahu.
7. Koneksi putus dan tersambung kembali saat perjalanan berjalan.
8. Ganti tema terang/gelap berulang di semua layar.

## Keputusan yang dibutuhkan dari Owner (D1-D4, sudah diputuskan 2026-09-26)
1. ~~Radius dan batas waktu~~ → 5 km, 3 menit. Selesai.
2. ~~Komisi 8% pesanan tunai~~ → dipotong dari saldo driver, jalur top up manual dibangun. Selesai (kode), **belum diuji sampai tuntas dengan transfer sungguhan** — lihat E3.
3. ~~Kunci penandatangan~~ → kunci baru khusus driver. Selesai.
4. ~~Firebase driver_app~~ → didaftarkan, `google-services.json` terpasang. Selesai.
5. ~~Face check harian~~ → wajib sebelum ONLINE. Kodenya selesai, **fitur masih dimatikan di server** menunggu E2.

---

# Fase E: dari uji HP pertama (27 Sep 2026) sampai 100% siap Play Store

Ditulis setelah penilaian jujur: setelah D1-D4 dan perbaikan 4 bug uji HP pertama (lihat
`DRIVER_APP_1_0_0_3_RELEASE_NOTES.md` bagian D4.1), driver_app **~20-25% siap rilis publik**. Dua bug yang
baru diperbaiki (Google Sign-In dan tombol Online) membuat aplikasi tidak bisa dipakai sama sekali untuk
fungsi paling dasar — itu tandanya masih ada risiko bug besar lain yang belum ketemu karena belum pernah diuji
tuntas di HP sungguhan. Fase ini urutannya BUKAN sembarang: E1 sebelum yang lain, karena tanpa bukti lapangan,
mengerjakan E3-E7 berisiko membangun di atas fondasi yang masih rapuh.

## E1. Bukti nyata di lapangan (dua HP) — ukuran M, prasyarat semua fase lain
1. Owner konfirmasi 4 perbaikan 27 Sep (Google Sign-In, tombol Online, kartu Pengajuan Mitra, ikon) bekerja di HP.
2. Jalankan 8 skenario di bagian "Uji lapangan wajib" di atas, dua HP sungguhan (driver + penumpang Owner sendiri),
   dicatat hasil per skenario.
3. Setiap kegagalan → baris baru di `REGRESSION_REGISTER.md` dengan akar masalah dan tes penjaga, diperbaiki,
   diuji ulang dari awal skenario itu (bukan cuma bagian yang gagal).
Selesai bila: 8 skenario lolos dua kali berturut-turut, di hari yang berbeda.

## E2. Menutup celah keamanan verifikasi wajah — ukuran L, **keputusan Owner dulu**
Masalah (dilaporkan 27 Sep): server mempercayai skor kemiripan yang dihitung DAN dikirim aplikasi sendiri,
tidak menghitung ulang dari foto — aplikasi yang dimodifikasi bisa mengklaim "wajah cocok" tanpa wajah asli.
Dua jalan:
- **(a) Pindahkan pencocokan ke server.** Aplikasi mengirim foto (bukan skor) terenkripsi; backend menghitung
  similarity sendiri dari referensi yang sudah tersimpan. Menutup celah sepenuhnya. Perubahan arsitektur nyata:
  perlu model/pustaka pencocokan wajah di Node, jalur unggah foto terenkripsi harian, dan pengujian ulang
  seluruh alur `DriverFaceCheckService`. Estimasi tidak kecil — ini pekerjaan tersendiri, bukan tambalan.
- **(b) Terima risikonya untuk closed testing** dengan driver pilot sedikit dan dikenal langsung oleh Owner
  (bukan publik), sambil (a) dikerjakan sebelum rilis produksi.
**Rekomendasi:** (b) untuk E6 (closed testing), (a) **wajib** selesai sebelum E7 (rilis produksi publik).
Owner memutuskan: kerjakan (a) sekarang sejajar dengan fase lain, atau ditunda sampai closed testing selesai?

## E3. Uang sungguhan: komisi dan top up manual — ukuran M
1. Owner menuntaskan uji top up manual end-to-end (transfer sungguhan ke rekening BRI → konfirmasi Super Admin
   di konsol admin → saldo bertambah tepat nominal) minimal 2 kali dengan nominal berbeda.
2. Setelah itu, nyalakan `DRIVER_COMMISSION_ENABLED=true` di server, uji satu siklus pesanan tunai penuh dengan
   driver pilot: saldo cukup → tawaran diterima → selesai → potongan 8% tercatat di tab Pendapatan. Saldo
   kurang → tawaran ditolak dengan pesan jelas, bukan error mentah.
Selesai bila: satu driver menjalani satu hari kerja penuh dengan komisi menyala tanpa keluhan saldo salah.

## E4. Gerbang versi minimum driver — ukuran S
Sekarang **driver_app tidak mengirim header `X-TapGo-Platform`/`X-TapGo-App-Version`/`X-TapGo-Distribution`
sama sekali** — `legacyMobileClientGate` di server hanya aktif bila header itu ada, jadi APK driver versi lama
TIDAK PERNAH ditolak, untuk selamanya, sampai ini dikerjakan. Bukan sekadar mengaktifkan yang sudah ada.
1. driver_app: tambahkan header yang sama seperti user_app ke setiap permintaan (`Dio` interceptor).
2. Backend: env baru `DRIVER_MIN_APP_BUILD` terpisah dari `MOBILE_MIN_APP_BUILD` (menaikkan yang lama akan ikut
   memblokir user_app) — gate membaca env yang sesuai berdasarkan payload klien.
3. Uji: APK versi lama ditolak dengan pesan jelas ("Perbarui dari Play Store"), versi baru diterima.
Selesai bila: uji di atas lolos, dan `versionCode` driver_app naik setiap rilis (bukan tetap 1.0.0+3 selamanya).

## E5. Kesiapan Play Console — ukuran M
1. **Data safety** khusus driver_app: lokasi latar depan saat online, kamera (verifikasi wajah), dokumen
   identitas (KTP/SIM), kontak (WhatsApp support baru — lihat menu Bantuan).
2. **Kebijakan privasi driver_app** dipastikan mencakup semua di atas plus retensi dokumen 24 jam.
3. **Aset listing**: ikon baru (selesai 27 Sep), screenshot dari HP asli minimal 4 (bukan emulator), feature
   graphic, deskripsi singkat/panjang.
4. **Akun uji untuk reviewer Google**: satu akun driver ACTIVE dengan kendaraan terverifikasi, supaya reviewer
   bisa login dan melihat alur kerja tanpa perlu Owner mendampingi.
5. **Deklarasi foreground service (lokasi)** — Play Console punya form terpisah untuk ini sejak kebijakan 2024;
   wajib diisi jujur sesuai yang sudah dibangun di D3.
Selesai bila: semua deklarasi terisi tanpa peringatan merah di pre-launch report Play Console.

## E6. Closed testing — ukuran M, minimal 1 minggu kalender
1. 5-10 driver pilot + 2 penumpang (keputusan Owner 26 Sep), dengan face check TETAP MATI (lihat E2) kecuali
   (a) sudah selesai.
2. Daftar uji harian: siapa online, berapa pesanan, error yang muncul, dicatat bukan cuma diingat.
3. Kriteria lolos: tidak ada crash fatal, tidak ada laporan pesanan hilang/duplikat, tidak ada laporan saldo
   salah (bila E3 sudah menyala).
Selesai bila: 7 hari berturut-turut tanpa insiden kritis.

## E7. Rilis produksi bertahap — ukuran S
1. **Syarat wajib sebelum fase ini**: E2(a) sudah selesai bila rilis untuk publik umum (bukan driver
   terverifikasi manual seperti pilot).
2. Rilis 20% dulu, pantau 2-3 hari lewat Play Console (crash rate, ANR rate, ulasan).
3. Naik ke 100% bila tidak ada laporan baru.

## Ringkasan urutan
E1 (wajib lebih dulu) → E3 & E4 & E5 bisa paralel setelah E1 lolos → E2 mulai kapan pun Owner putuskan, tapi
harus SELESAI sebelum E7 → E6 (perlu E1 lolos, E2 opsional untuk pilot) → E7 (perlu E2 selesai + E6 lolos).

Estimasi waktu kalender kasar bila dikerjakan berurutan tanpa hambatan: E1 beberapa hari (tergantung jadwal uji
Owner), E3-E5 1-2 minggu kerja, E2 opsi (a) 1-2 minggu tersendiri, E6 minimal 1 minggu, E7 beberapa hari. Total
realistis **4-6 minggu** dari sekarang sampai 100%, bukan hitungan hari — dan itu dengan asumsi E1 tidak
menemukan bug besar baru.
6. **Cara rilis**: closed testing dengan driver pilot dulu (disarankan) atau langsung produksi?
