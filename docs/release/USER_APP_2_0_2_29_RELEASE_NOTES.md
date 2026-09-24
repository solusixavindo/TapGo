# TapGo user_app 2.0.2+29 — catatan rilis dan daftar uji

Tanggal: 2026-09-24. Acuan perbandingan: 2.0.1+28 (commit `63a9590`).

## Perubahan untuk pengguna
- Tab **Aktivitas** memuat pembelian PPOB, perjalanan ojek, dan mutasi saldo
  (top up, transfer, pengembalian dana). Bonus, komisi, dan pencairan tidak tampil.
- Kartu saldo di Beranda membuka layar **TapGoPay** (saldo, Top Up web, Transfer, riwayat).
- Tab **Chat** menampilkan percakapan bantuan (tiket dukungan) dan tombol Hubungi Bantuan.
- Menu Akun: **Ubah Password** (sebelumnya tidak terjangkau di build Play) dan versi aplikasi.
- Pesan error berbahasa Indonesia di seluruh alur; petunjuk password daftar "Minimal 6 karakter".
- Pembaruan dari +28 tidak memaksa login ulang.

## Perubahan keamanan dan kebersihan
- Seluruh kode admin, Founder, dan distribusi direct dihapus dari aplikasi (bukan disembunyikan).
- Data lama di HP (daftar pendaftar, lokasi foto KTP/selfie) dibersihkan sekali saat dibuka.
- Plugin tak terpakai `firebase_messaging` dan `google_maps_flutter` dihapus: izin
  POST_NOTIFICATIONS, WAKE_LOCK, dan penerima c2dm hilang dari manifes.
- Header versi aplikasi kini nyata (sebelumnya konstanta `1.0.3+4`); server dapat menolak build lama
  lewat `MOBILE_LEGACY_CLIENT_BLOCK_ENABLED` (default mati).

## Artefak
- AAB (Play): versionCode 29, ditandatangani kunci unggah PT TapGo Lion Indonesia.
- APK (uji HP): universal, versionCode 29. Bila +28 terpasang lewat Play, copot dulu (tanda tangan berbeda).
- Pemindai `scripts/verify-mobile-artifact.sh` lulus pada keduanya.

## Daftar uji di HP
1. Daftar akun baru, keluar, masuk lagi.
2. Beranda: kartu saldo membuka TapGoPay; Top Up membuka web; Transfer berfungsi dan saldo berubah.
3. Aktivitas: pembelian PPOB dan ojek Anda tampil dengan nominal, status, dan tanggal benar; filter Layanan/Saldo; tarik ke bawah.
4. PPOB: beli pulsa (nominal kecil), cek muncul di Aktivitas.
5. Ojek: pesan lalu batalkan; cek riwayat.
6. Chat: buat tiket lewat Hubungi Bantuan; tiket muncul di tab Chat.
7. Akun: Profil, Ubah Password (lalu masuk ulang), Tampilan gelap, Hapus Akun (jangan kirim), versi tampil "2.0.2 (29)".
8. Matikan internet: setiap layar menampilkan pesan Indonesia dan tombol muat ulang, tidak crash.
9. Perbarui dari +28 tanpa mencopot (bila kunci sama): tetap masuk tanpa login ulang.
