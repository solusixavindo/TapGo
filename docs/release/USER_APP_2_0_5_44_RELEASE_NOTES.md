# TapGo user_app 2.0.5+44 — nomor token tampil, satu akun satu HP, nomor HP seluler Indonesia

Tanggal: 2026-10-09. Dasar: 2.0.5+43 (isi +43 tetap berlaku; tampilan yang sudah baik tidak diubah). `versionCode` 44. Pin tetap trust-anchor.
Dasar perubahan: laporan Owner dari +43 di Play Store — (1) pembeli token listrik tidak menerima nomor tokennya walau transaksi
sukses di Digiflazz, (2) satu akun aktif di banyak HP, (3) satu HP mendaftarkan banyak akun, (4) pendaftaran dengan nomor sembarangan.

**Backend WAJIB dirilis lebih dulu** (cabang `release/driver-rating`, commit `dd37db9` dan pengaman finalisasi di atasnya). +44 aman
di server lama (kolom token dan sidik perangkat hanya tidak berguna), tetapi perbaikannya baru berlaku penuh bersama server baru.

## Perubahan
1. **Nomor token/referensi tampil** di kartu hasil transaksi, kartu hasil tagihan, dan Riwayat PPOB (kartu dua baris selebar kartu,
   tidak terpotong), dengan tombol salin (hanya nomor token yang disalin). Model `PpobOrder` membaca `serialNumber`.
2. **Hasil "Diproses" memperbarui diri**: transaksi yang masih Menunggu/Diproses dipantau tiap 6 detik (maks. 40 kali) sampai final;
   token listrik yang belum terbit menampilkan catatan "Token listrik sedang disiapkan penyedia" lalu nomor muncul sendiri.
   Kartu hasil tagihan memang sudah menjanjikan "status akan diperbarui otomatis" — kini ditepati.
3. **Pesan pengembalian dana** pada transaksi gagal: server mengirim `FAILED` + `refundedAt` (tidak pernah `REFUNDED`), jadi kalimat
   "Dana dikembalikan penuh ke saldo Anda" sebelumnya tidak pernah muncul di kartu hasil; kini muncul.
4. **Sidik perangkat dari ANDROID_ID** (di-hash SHA-256 di sisi native, `deviceHardwareId` pada MethodChannel `tapgo.user/alerts`)
   supaya batas "satu HP satu akun" di server tidak lolos dengan hapus-data/pasang-ulang. Cadangan: sidik lama bila tidak tersedia.
5. **Nomor HP pendaftaran** diperketat sama dengan server (081–089, 10–13 digit, bukan deretan sama/berurutan). Pesan tetap
   "Nomor HP tidak valid". Aturan login TIDAK diubah (akun lama tetap bisa masuk).
6. Pesan `DEVICE_ACCOUNT_LIMIT`: "HP ini sudah dipakai mendaftarkan akun TapGo. Silakan pilih Login dengan akun tersebut."
7. Data Safety Play: sidik perangkat kini berasal dari ID perangkat (hash) — sudah tercakup pada "Device or other IDs" bila
   dideklarasikan untuk pencegahan penipuan; periksa kembali isiannya.

## Uji
`test/serial_and_registration_phone_test.dart`, `test/ppob_order_watcher_test.dart`, `test/ppob_customer_test.dart` (alur lengkap
Diproses -> token muncul; gagal -> dana dikembalikan), `test/register_login_flow_test.dart`. Backend: `userSessionDeviceAndPhone`,
`indonesianMobilePhone`, `ppob.integration` (serialNumber), `digiflazz.integration` (Pending -> Sukses -> token, sukses tanpa token
ditahan, webhook ditunda). Mutasi dibuktikan: tanpa perbaikan serializer, pengaman SN, dan batas perangkat, tiap uji gagal.
Bukti visual: aplikasi (profil web) dijalankan di localhost melawan backend lokal dan Digiflazz palsu berformat token PLN asli.

## Belum terbukti
Jalur native `deviceHardwareId` belum dijalankan di HP nyata (hanya cadangannya yang teruji di web). Bunyi dan push tidak berubah.
Pembelian token nyata dengan provider asli belum diuji ulang di +44.
