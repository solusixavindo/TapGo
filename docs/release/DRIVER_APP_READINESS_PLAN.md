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

## Keputusan yang dibutuhkan dari Owner
1. **Radius dan batas waktu**: bawaan 5 km dan 3 menit (usulan). Setuju atau ubah?
2. **Komisi 8% pesanan tunai**: bagaimana ditagih? Usulan lama: dipotong dari saldo driver, driver hanya bisa menerima pesanan tunai bila saldo cukup. Ini butuh jalur isi saldo driver (top up manual yang sudah dirancang, karena Midtrans belum aktif). Mulai sekarang atau ditunda dan ride tanpa komisi dulu selama pilot?
3. **Kunci penandatangan** driver_app: baru, atau memakai kunci user_app?
4. **Firebase driver_app**: daftarkan `com.xavindo.tapgo.driver` di proyek Firebase yang sama dan berikan `google-services.json`.
5. **Face check harian**: wajib sebelum boleh ONLINE, atau hanya peringatan selama pilot?
6. **Cara rilis**: closed testing dengan driver pilot dulu (disarankan) atau langsung produksi?
