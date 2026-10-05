# Rencana upload Play Store — Rabu, 7 Oktober 2026

Cakupan: **user_app** sebagai pembaruan dari versi lama (produksi sekarang 2.0.5+32), dan **driver_app**
sebagai rilis pertama di Play Store. Dokumen ini rencana, bukan laporan: tidak ada langkah di Play Console
yang dikerjakan dari repo ini (login Play Console hanya oleh Owner), dan belum ada uji HP untuk +12/+37.

## 0. Yang harus diterima apa adanya

1. **Mengunggah dan mengirim ke tinjauan bisa dilakukan Rabu. "Tayang" Rabu tidak dapat dijamin.** Waktu
   tinjauan Google tidak bisa dijanjikan: pembaruan biasanya jam sampai beberapa hari, aplikasi baru lebih
   lama. Pakai **Managed publishing** supaya setelah disetujui Anda yang menentukan menit tayangnya.
2. **Driver sebagai rilis produksi pertama tidak terblokir aturan akun** (akun organisasi, lihat G1); yang masih bisa menghambat adalah G2 (16 KB), G3, dan G4.
3. **Backend produksi belum lengkap** (lihat G3). Itu harus selesai sebelum pengguna sungguhan menerima
   pembaruan.

## 1. Gerbang keputusan (Selasa malam / Rabu pagi, sebelum upload apa pun)

| # | Gerbang | Cara memeriksa | Bila gagal |
|---|---|---|---|
| G1 | **Jenis akun developer — SELESAI (6 Okt 2026):** Owner menyatakan publikasi memakai **akun organisasi**, jadi syarat closed testing akun pribadi (≥ 12 penguji × 14 hari) **tidak berlaku**. | Cukup konfirmasi di dashboard bahwa jalur Production driver_app terbuka. | Bila Play tetap menampilkan syarat itu, kabari: berarti akun yang dipakai bukan akun organisasi tersebut. |
| G2 | **Keselarasan 16 KB — DIPERBAIKI di driver +12 (6 Okt 2026).** AAB +11 punya 2 pustaka x86_64 TFLite yang tidak selaras (4 KB). +12 mengeluarkan x86_64 saat pengemasan (hanya arm64-v8a dan armeabi-v7a); semua pustaka 64-bit selaras 16 KB, dan gerbang rilis kini memeriksanya (`scripts/check-native-alignment.sh`). **Unggah +12, bukan +11.** | Selasa: unggah AAB +12 ke Internal testing dan pastikan Play tidak memperingatkan soal 16 KB. | Bila Play tetap memperingatkan, kirim teks peringatannya persis. |
| G3 | **Rilis backend** `release/driver-rating` (2d9b8b4) sudah di-cutover dan terverifikasi (panduan ada di laporan sebelumnya). Tanpa itu: penilaian menampilkan "belum tersedia" ke pengguna sungguhan, banner penolakan lemah, dan bunyi notifikasi latar belakang masih memakai channel lama. | Log `POST .../rating` → 201 dan satu baris di `ride_ratings`. | **Jangan** mulai rollout user_app ke produksi. Internal testing boleh. |
| G4 | **SOS, safety-status, dan face-check belum ada di backend produksi.** Driver +12 di produksi: tombol SOS menampilkan pesan gagal dengan jalur WhatsApp CS; banner kelelahan dan verifikasi wajah tidak muncul. Itu perilaku yang sudah didokumentasikan, tetapi tombol yang tidak bekerja akan terlihat oleh peninjau Google dan driver. | Keputusan Owner. | Pilihan: (a) rilis dengan keterbatasan dan tulis jujur di catatan peninjau; (b) tunda driver sampai backend PR #1 dirilis (bukan pekerjaan Rabu). Rekomendasi: (a) hanya untuk Closed testing, (b) sebelum produksi publik. |
| G5 | **Uji HP.** Belum ada uji HP untuk +12/+37. | Pasang dari **Internal testing Play** (bundel yang ditandatangani Play, persis yang diterima pengguna), lalu jalankan daftar di bagian 6. | Temuan P0/P1 = jangan promosikan ke produksi. |
| G6 | **Kunci unggah cocok.** Sidik jari sertifikat AAB harus sama dengan "Upload key certificate" di Play Console → App integrity. user_app: `90:A9:5A:AC:…` (SHA-256 `90a95aac052b6488a870b0c86d2697f5e3d42f8f13295b7854a6638ed013473b`). driver_app: `04aa1a8091c099385da40ff4bc995e267f4561267e3335bd7865093b5daa89c4`. | Bandingkan di App integrity. | Jangan unggah; kunci unggah salah akan ditolak, dan kunci hilang harus diatur ulang lewat dukungan Play. |

## 2. Artefak yang akan diunggah (semua lewat gerbang rilis, "GERBANG LOLOS")

| Aplikasi | Berkas | versionCode | Package | sha256 AAB |
|---|---|---|---|---|
| user_app | `~/Desktop/tapgo-user-2.0.5+37.aab` | 37 (> 32 produksi) | `com.xavindo.tapgo` | `e8d3cc323cb76b4fa450693e860b0f062a5bf1420342984aaeddd72a47b27d4a` |
| driver_app | `~/Desktop/tapgo-driver-1.0.0+12.aab` | 12 | `com.xavindo.tapgo.driver` | `3e80cc27818828cade99483db5cc20ea04f286377be7ea7929631660dd983951` |

Keduanya: minSdk 24, targetSdk 36, pin TLS trust-anchor, tanpa izin terlarang (`RECORD_AUDIO`, dsb.).
Unggah **AAB**, bukan APK. APK hanya untuk uji di HP. Dokumen lama menyebut package `id.tapgolion.tapgo`;
itu usang, yang benar adalah package di tabel ini. Jangan membangun ulang tanpa alasan: setiap build baru
mengubah sha256 dan harus lewat gerbang lagi.

## 3. Garis waktu yang disarankan (WIB)

### Selasa 6 Okt (sisa hari)
1. G6: cocokkan sidik jari kunci unggah (kedua aplikasi).
2. **Unggah user_app 37 ke Internal testing** (tanpa tinjauan; tersedia cepat). Pasang di HP dari tautan
   Internal testing. Jalankan daftar uji bagian 6A.
3. **Unggah driver_app 12 ke Internal testing** (membuat aplikasi baru bila belum ada, lihat 5.1). Ini
   sekaligus menjawab G2 (Play menerima/menolak AAB). Jalankan bagian 6B.
4. Cutover backend (G3) bila belum, atau tetapkan jamnya Rabu pagi.
5. Putuskan G4 (G1 sudah selesai: akun organisasi).

### Rabu 7 Okt
| Jam | Pekerjaan |
|---|---|
| 08:00 | Tinjau hasil uji semalam. Tidak ada P0/P1 → lanjut. Pastikan G3 (backend) terverifikasi: log `/rating` 201. |
| 09:00 | **user_app:** buat rilis **Production**, pilih AAB 37 dari library (yang sudah diuji di Internal), isi catatan rilis (bagian 4), **rollout bertahap 20%**, nyalakan Managed publishing, **kirim ke tinjauan**. |
| 10:30 | **driver_app:** lengkapi semua deklarasi (bagian 5.2), lalu **Production** dengan rollout bertahap (mulai kecil). Closed testing opsional (bukan keharusan) bila Anda ingin uji lapangan terbatas lebih dulu. |
| siang | Menunggu tinjauan. Pantau email Play Console dan Sentry. Isi balasan bila peninjau meminta akun/penjelasan. |
| setelah disetujui | **Publikasikan** (Managed publishing) hanya bila G3 masih hijau. user_app tetap 20% dulu. |
| sore | Pantau 3–6 jam (bagian 7). Naikkan bertahap (20% → 50% → 100%) hanya bila tidak ada lonjakan galat. |

Bila persetujuan baru datang Kamis atau lebih lambat, itu normal dan tidak berarti ada yang salah.

## 4. user_app — pembaruan dari 2.0.5+32 ke 2.0.5+37

- Pembaruan dari 32 melompati 33–36 (hanya Internal/uji); itu tidak masalah, hanya versionCode yang harus naik.
- Build 32 dibangun sebelum pin TLS ada; +37 adalah rilis berpin pertama bagi pengguna produksi. Pin kini
  trust-anchor (bukan kunci leaf), jadi pergantian sertifikat server tidak memutus aplikasi. Karena itu
  tetap **rollout bertahap 20%**, bukan 100%, dan pantau Sentry untuk `TLS_PIN_MISMATCH`/`TLS_CERTIFICATE_INVALID`.
- Izin baru hanya `VIBRATE` (izin biasa; tidak perlu deklarasi).
- Data Safety: tidak ada kategori data baru kecuali catatan penilaian yang dikirim ke server; **periksa**
  apakah deklarasi "konten buatan pengguna" perlu diperbarui. Jangan menjawab dari ingatan.
- Catatan rilis (id-ID, maksimal 500 karakter), usulan:
  > Pembaruan TapGo: pencarian lokasi kini menampilkan tempat terdekat dari posisi Anda, Tempat cepat bisa
  > dihapus, penilaian driver setelah perjalanan selesai, pemberitahuan lebih jelas saat driver tidak
  > mengambil pesanan, serta bunyi dan popup untuk pesan chat. Perbaikan stabilitas dan keamanan koneksi.
  >
  > **Hanya pakai kalimat penilaian/pemberitahuan penolakan bila G3 sudah hijau.**

## 5. driver_app — rilis pertama

### 5.1 Membuat aplikasi (bila belum ada)
Play Console → Create app: nama "TapGo Driver", bahasa default Indonesia, jenis Aplikasi, **gratis**.
Package ditetapkan oleh AAB pertama (`com.xavindo.tapgo.driver`) dan tidak bisa diganti. Aktifkan
**Play App Signing** (bawaan) dengan kunci unggah yang sama dengan G6.

### 5.2 Daftar isian wajib (semua oleh Owner; bahan sudah ada di repo)
| Isian | Bahan / catatan |
|---|---|
| Store listing | `GOOGLE_PLAY_DRIVER_APP_LISTING_DRAFT.md`; ikon 512 baru dan feature graphic di `google-play-assets/driver/` |
| **Screenshot dari HP asli (min. 4)** | Tidak bisa dibuat dari sini. Ambil dari +12 yang sudah terpasang: beranda Online, tawaran masuk, perjalanan aktif, pendapatan |
| Data Safety | `GOOGLE_PLAY_DRIVER_APP_DATA_SAFETY_MAPPING.md` — salin baris demi baris |
| App access | Akun reviewer: jalankan `npm run driver:reviewer-bootstrap` di server (`DRIVER_APP_REVIEWER_TEST_ACCOUNT.md`); kredensial hanya di Play Console, tidak di chat/repo |
| Foreground service (lokasi) | Jenis Location; manifest benar (tanpa `ACCESS_BACKGROUND_LOCATION`). Play biasanya meminta **video singkat** yang memperlihatkan fitur dan notifikasi "TapGo Driver aktif": rekam di HP |
| Deklarasi lokasi | Hanya lokasi saat aplikasi dipakai + layanan latar untuk status Online |
| Content rating, target audience (dewasa), Ads (tidak ada), fitur finansial | Isi sesuai perilaku nyata |
| Penghapusan akun | URL/petunjuk sudah ada (verifikasi hidup) |
| OAuth Google (project `tapgo-c7cb3`) | Masih **Testing** (hanya test user). Selesaikan "Publish app" **sebelum produksi publik** bila Login dengan Google dipertahankan |
| Catatan untuk peninjau | Jelaskan: SOS/verifikasi wajah belum aktif di server (G4); fitur komisi/face-check dimatikan; akun reviewer tanpa kendaraan terverifikasi |

### 5.3 Rilis
Akun organisasi: **Production** langsung, rollout bertahap, mulai ≤ 20%, Managed publishing menyala. Closed
testing bersifat pilihan (mis. uji lapangan 2 HP di `DRIVER_APP_FIELD_TEST.md`), bukan syarat.

## 6. Daftar uji singkat dari Internal testing Play (jalankan Selasa malam)

**6A user_app +37** (akun uji sendiri):
- [ ] Pasang, buka, login; sesi pulih setelah tutup paksa.
- [ ] Salah password → pesan "Nomor HP atau password salah" (bukti TLS hidup).
- [ ] Ketik "alfamart" di Titik jemput dan Tujuan; hasil teratas terdekat; GPS mati → pesan lokasi.
- [ ] Tempat cepat: tekan lama Rumah/Kantor → hapus.
- [ ] Pesan perjalanan, driver menerima: berbunyi **sekali** saat aplikasi terbuka; chat saat layar chat
      tertutup → popup + sekali bunyi.
- [ ] Setelah G3: perjalanan selesai → beri bintang sekali; kirim ulang ditolak.
- [ ] Pengaturan Android → Notifikasi: ada "Peringatan TapGo".

**6B driver_app +12**:
- [ ] Pasang dari tautan Internal, login (nomor HP; Google hanya test user), beranda termuat.
- [ ] Online → "TapGo Driver aktif" tampil, **tanpa berbunyi**.
- [ ] Order masuk saat aplikasi terbuka → ringtone **sekali**, lembar tawaran terbuka.
- [ ] Chat penumpang saat layar chat tertutup → popup + sekali bunyi; saat terbuka → senyap.
- [ ] Tutup lalu buka lagi saat server Online → kartu tetap Online.
- [ ] Tombol SOS: pesan gagal yang jelas + WhatsApp CS (perilaku G4), tidak crash.

## 7. Kriteria berhenti dan pemulihan

- **Hentikan rollout** (Play Console → Halt rollout) bila: crash/ANR melonjak di Android vitals, Sentry
  menunjukkan `TLS_PIN_MISMATCH`/`TLS_CERTIFICATE_INVALID` massal, login gagal massal, atau penilaian/chat rusak.
- **Play tidak bisa menurunkan versionCode.** Perbaikan = build baru dengan versionCode lebih tinggi
  (user 38, driver 13), lewat gerbang rilis, lalu unggah ulang. Karena itu rollout bertahap penting.
- Backend dapat di-rollback sendiri ke `tapgo-5588076` (blok rollback ada di panduan VPS); migrasi tidak
  dibatalkan dan tabel `ride_ratings` tidak mengganggu kode lama.
- Pantau: Android vitals (crash/ANR), Sentry, `pm2 logs tapgo-api`, email Play Console, dan kanal bantuan.

## 8. Yang belum terbukti

Uji HP +12/+37; penerimaan Play atas AAB driver +12 (G2); backend `release/driver-rating`
di produksi (G3). Dokumen ini tidak menyatakan rilis Rabu pasti tayang.
