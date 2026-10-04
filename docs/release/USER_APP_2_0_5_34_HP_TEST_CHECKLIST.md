# Daftar uji HP — TapGo user_app 2.0.5+34

Tujuan: memastikan build pertama yang membawa trust-anchor pinning TLS ini berfungsi di perangkat nyata
sebelum diunggah ke track uji Play. Dokumen ini belum berisi hasil uji HP; belum ada uji HP untuk build ini.

**2.0.5+33 tidak dapat terhubung ke server dan tidak boleh dipasang** (cacat pinning; lihat
`TLS_TRUST_ANCHORS.md`). Yang sudah dibuktikan di luar HP: tes handshake sungguhan dengan CA sintetis,
gerbang rilis yang menjalankan handshake nyata ke `api.tapgolion.id` dengan kode aplikasi, dan probe kecil
yang memakai berkas anchor yang sama di emulator Android x86_64 (mode rilis) yang mendapat HTTP 200 dari
server produksi (tanpa anchor ditolak). Aplikasi penuh belum diuji ujung ke ujung; itulah isi dokumen ini.

- Berkas: `tapgo-user-2.0.5+34.apk` (versionCode 34, versionName 2.0.5)
- SHA-256 APK: `967c172bd4e7de5763e646618c61857c5e899ae98e549e918897dc61d4c45085`
- Tanda tangan sama dengan build user_app sebelumnya (2.0.2) yang ada di laptop pengembang.
- Server: produksi (`api.tapgolion.id`). Pembelian PPOB dan transfer memakai uang sungguhan.

## 0. Persiapan

- [ ] Siapkan **2 HP** bila ingin menguji ojek penuh: HP penumpang (+34) dan HP driver
      (`tapgo-driver-1.0.0+7.apk`). Satu HP cukup untuk bagian lain.
- [ ] Siapkan **akun uji penumpang milik sendiri** dengan saldo kecil. Jangan memakai akun pelanggan.
- [ ] Cocokkan checksum APK di laptop: `shasum -a 256 tapgo-user-2.0.5+34.apk`.
- [ ] Pasang. Bila HP menolak dengan konflik tanda tangan (aplikasi yang sudah terpasang berasal dari
      Play dan ditandatangani kunci lain), hapus aplikasi lama dulu. Itu perilaku Android, bukan bug,
      dan data lokal aplikasi lama ikut hilang.
- [ ] Pengaturan Android → Aplikasi → TapGo: versi tampil 2.0.5.

## 1. Pin TLS (inti build ini) — wajib lulus semua

Pesan yang BUKAN lulus: "Perbarui aplikasi dari Google Play…", "belum dikonfigurasi dengan benar", atau
"Periksa tanggal dan jam HP Anda…" saat jaringan normal. Itu berarti handshake TLS gagal: hentikan uji,
ambil screenshot, catat jaringan yang dipakai (Wi-Fi atau data) dan laporkan.

- [ ] 1.0 **Bukti handshake yang paling sederhana:** di layar login, masukkan nomor HP dan password yang
      **sengaja salah**. Pesan yang benar: "Nomor HP atau password salah." Pesan itu hanya muncul bila
      aplikasi berhasil berbicara dengan server lewat TLS. Bila yang muncul "Perbarui aplikasi…" atau
      "Server TapGo belum dapat dihubungi", handshake gagal.
- [ ] 1.1 Wi-Fi biasa: buka aplikasi lalu login. Berhasil sampai Beranda.
- [ ] 1.2 Data seluler (matikan Wi-Fi): tutup aplikasi, buka lagi, login ulang atau muat Beranda. Berhasil.
- [ ] 1.3 **Mode pesawat**, lalu coba login. Pesan yang benar: "Server TapGo belum dapat dihubungi…"
      (pesan jaringan biasa, BUKAN pesan TLS).
- [ ] 1.4 Matikan mode pesawat, coba lagi **tanpa menutup aplikasi**. Berhasil.
- [ ] 1.5 (Opsional) Wi-Fi umum dengan halaman login/captive portal yang belum dimasuki: catat pesan yang
      tampil. Pesan TLS di sini wajar karena jaringan itu mencegat koneksi; yang penting aplikasi tidak
      crash dan pulih setelah pindah ke jaringan normal.

- [ ] 1.6 **Jam HP salah:** matikan "Tanggal & waktu otomatis", majukan tanggal minimal satu tahun, lalu
      coba login. Pesan yang benar: "Periksa tanggal dan jam HP Anda… belum tentu berarti aplikasi harus
      diperbarui." (sertifikat server dianggap kedaluwarsa). **Kembalikan ke otomatis** sesudahnya dan
      pastikan login normal lagi.

## 2. Autentikasi dan akun

- [ ] 2.1 Login dengan akun uji. Berhasil.
- [ ] 2.2 Login dengan password salah: tetap di layar login, pesan "Nomor HP atau password salah."
- [ ] 2.3 Tutup paksa aplikasi (geser dari recent apps), buka lagi: sesi pulih tanpa login ulang.
- [ ] 2.4 Lupa password: ajukan pemulihan. Hasilnya bergantung konfigurasi server (kode ke email, atau
      pesan "Layanan pemulihan belum tersedia"). Yang dinilai: pesan jelas, berbahasa Indonesia, tidak crash.
- [ ] 2.5 Akun → Ubah Password: berhasil, lalu aplikasi kembali ke layar masuk (semua sesi dicabut).
      Login dengan password baru berhasil. Kembalikan password bila perlu.
- [ ] 2.6 Logout: kembali ke layar masuk.
- [ ] 2.7 Daftar akun baru (hanya bila Anda memang ingin membuat akun uji di produksi).

## 3. Beranda dan menu

- [ ] 3.1 Grid layanan tampil: Motor, Mobil, PPOB, Kartu Anggota. Tidak ada teks terpotong.
- [ ] 3.2 Kartu Anggota terbuka dan memuat data.
- [ ] 3.3 Tab Aktivitas, Chat, Akun terbuka tanpa galat.
- [ ] 3.4 Menu Akun: Kartu Anggota, Profil, Tiket Bantuan, Kebijakan Privasi, Syarat & Ketentuan,
      Hubungi Kami, Bantuan, Logout, Hapus Akun. Semua ada.
- [ ] 3.5 Tampilan → ganti terang/gelap enam kali berturut-turut: tidak muncul "Terjadi gangguan tampilan".

## 4. Ojek Online (Motor dan Mobil)

Gunakan HP kedua dengan driver +7 dan akun driver aktif yang online.

- [ ] 4.1 Izin lokasi diminta dan diberikan; titik jemput terisi.
- [ ] 4.2 Pilih tujuan, cek harga: estimasi tampil.
- [ ] 4.3 Pesan dengan **tunai**. Pesanan masuk status mencari driver.
- [ ] 4.4 Di HP driver: tawaran muncul sebagai popup, diterima. Di HP penumpang: status berubah dan data
      driver tampil.
- [ ] 4.5 Posisi driver bergerak di peta penumpang selama perjalanan.
- [ ] 4.6 Chat penumpang–driver: pesan terkirim dan diterima kedua arah.
- [ ] 4.7 Notifikasi push saat status berubah: uji dengan aplikasi di latar belakang **dan** di depan.
      Mengetuk notifikasi membuka perjalanan.
- [ ] 4.8 Perjalanan selesai: struk tampil; riwayat ada di Aktivitas.
- [ ] 4.9 Pesanan kedua dibatalkan dengan alasan: status batal dan driver dilepas.
- [ ] 4.10 Matikan data di tengah pemesanan: pesan jaringan yang jelas, tidak crash; hidupkan lagi, pulih.

## 5. PPOB (uang sungguhan — nominal terkecil)

- [ ] 5.1 Katalog dan kategori tampil.
- [ ] 5.2 Cek tagihan/nomor: hasil inquiry tampil.
- [ ] 5.3 Saldo PPOB kurang: pesan yang jelas, tidak crash.
- [ ] 5.4 Satu pembelian nominal terkecil (hanya bila saldo PPOB akun uji ada): status akhir dan riwayat order tampil.

## 6. TapGoPay dan dompet

- [ ] 6.1 Saldo tampil sama dengan konsol admin.
- [ ] 6.2 Transfer nominal kecil antar dua akun uji milik sendiri (di atas batas minimum): berhasil dan
      masuk riwayat di kedua akun.
- [ ] 6.3 Nominal di bawah minimum atau saldo kurang: pesan Indonesia yang jelas.

## 7. Profil dan bantuan

- [ ] 7.1 Profil terbuka; foto profil dimuat (atau ikon bawaan bila belum ada).
- [ ] 7.2 Ubah nomor HP (butuh password): hasilnya benar.
- [ ] 7.3 Tiket Bantuan: buat tiket (dengan lampiran foto), tiket muncul di daftar dan bisa dibuka.
- [ ] 7.4 Kebijakan Privasi dan Syarat & Ketentuan terbuka. Hubungi Kami membuka WhatsApp.
- [ ] 7.5 **Hapus Akun** hanya pada akun uji sekali pakai (tidak dapat dibatalkan). Lewati bila tidak perlu.

## 8. Ketahanan

- [ ] 8.1 Putar layar, teks besar (Pengaturan → Ukuran font maksimum): tidak ada overflow atau crash.
- [ ] 8.2 Tutup paksa di tengah proses lalu buka lagi: pulih.
- [ ] 8.3 Pindah Wi-Fi ↔ data saat aplikasi terbuka: berjalan, tanpa pesan TLS.
- [ ] 8.4 Biarkan aplikasi di latar belakang ≥ 30 menit lalu buka: sesi masih sah atau meminta login dengan wajar.

## 9. Pencatatan hasil

Salin tabel ini untuk setiap temuan.

| No. uji | Hasil (Lulus/Gagal) | Jaringan/HP/versi Android | Catatan | Screenshot |
|---|---|---|---|---|
| | | | | |

## 10. Kriteria dan jalur unggah ke Play

Keadaan Play Console (screenshot Owner, 4 Okt 2026): produksi terbaru **32 (2.0.5)**, rilis 26 Sep,
rollout 100%, sekitar 52 instalasi. Internal testing berisi 13 (1.0.11) dari 25 Jul. Closed testing
dan Open testing belum disiapkan. Build 32 dibangun sebelum kode pinning TLS masuk (1 Okt), jadi
pengguna produksi sekarang tidak memakai pin dan tidak terpengaruh penggantian sertifikat; +34 tidak
memperbaiki sesuatu yang rusak di Play.

### 10.1 Syarat naik ke Internal testing
- Seluruh bagian 1 lulus, tidak ada crash, dan tidak ada pesan TLS pada jaringan normal.
- Bagian 2 sampai 4 lulus; bagian 5 dan 6 lulus untuk yang dijalankan.
- Baca dulu chip "Unread notifications" di Play Console; isinya belum diketahui dan bisa memengaruhi rilis.

### 10.2 Jalur unggah
1. Unggah `tapgo-user-2.0.5+34.aab` ke **Internal testing** (tanpa peninjauan, cepat). versionCode 34
   lebih tinggi dari 32 dan 13, jadi diterima.
2. Uji dari tautan Internal testing. Ini menguji bundel yang ditandatangani Play, persis seperti yang
   akan diterima pengguna. (Bila memasang APK langsung, aplikasi dari Play harus dihapus dulu karena
   konflik tanda tangan.)
3. Ulangi bagian 1 sampai 4 pada pemasangan dari Play.

### 10.3 Syarat naik ke produksi
Jangan naik ke produksi sebelum **kedua** hal ini terpenuhi:
- Bagian 1 sampai 4 lulus pada pemasangan dari Play.
- Rencana pembaruan trust anchor di `TLS_TRUST_ANCHORS.md` dipahami dan dijadwalkan (anchor yang
  terdekat berakhir 2032-09-02; Let's Encrypt harus diikuti bila memindahkan rantainya).

Perpanjangan atau penggantian kunci sertifikat server **tidak lagi** memengaruhi aplikasi (tidak ada pin
leaf). Saat naik ke produksi, tetap mulai dengan **rollout bertahap (10–20%)**, bukan 100%, lalu pantau
Sentry dan laporan pengguna untuk kegagalan TLS sebelum melanjutkan.
