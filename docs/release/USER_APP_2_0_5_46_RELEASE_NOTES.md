# TapGo 2.0.5+46 — percepat masuk ke beranda dan pelacakan driver

Tanggal: 2026-10-16. Menggantikan 2.0.5+45 (isi +45 tetap berlaku). `versionCode` 46.
Menanggapi uji HP Owner 16 Okt 2026: "waktu loading lama untuk masuk dashboard, lingkaran berputar".

## Yang berubah
1. **Buka aplikasi (sudah login)**: pemulihan sesi tidak lagi mengambil snapshot paket+saldo (membership + dompet). Beranda sudah
   memuatnya sendiri begitu tampil, jadi sebelumnya permintaan yang sama berjalan DUA kali dan yang pertama menahan layar pertama.
   Selama menunggu, beranda memakai paket dan saldo tersimpan.
2. **Login**: status verifikasi diminta bersamaan dengan penyimpanan sesi di HP, bukan baru sesudahnya (satu putaran jaringan
   berurutan lebih sedikit sebelum beranda tampil).
3. **Pelacakan driver** (dari +45 versi lokal): selang ambil posisi 1,5 dtk dengan marker bergerak halus.

4. **Buka aplikasi (sudah login) — tanpa layar putih menunggu jaringan**: bila ada sesi tersimpan (token + data sesi), beranda langsung tampil
   dari sesi itu; validasi sesi ke server tetap berjalan di belakang dan, bila sesi ternyata sudah tidak sah, pengguna dikembalikan
   ke layar masuk. Pembacaan penyimpanan aman dibuat paralel dan pembersihan data lama hanya dijalankan sekali. Di driver_app
   pembacaan sesi juga paralel.
5. **Transfer saldo**: wajib memasukkan password akun (salah = ditolak, tidak ada saldo bergerak). Saldo hasil top up kini ikut
   bisa ditransfer (dibayar lebih dulu dari bagian top up); penerima menerimanya sebagai saldo top up yang tetap tidak bisa
   ditarik, sedangkan bagian yang bisa ditarik tetap bisa ditarik. Memerlukan rilis backend `tapgo-<sha>` berikutnya DAN
   `WALLET_TRANSFER_ENABLED=true` di server (tanpa itu layar menampilkan "Fitur transfer belum tersedia").

Sisi server (rilis backend `tapgo-<sha>` berikutnya): estimasi rute pelacakan dipakai ulang 5 dtk per pesanan, jadi jawaban posisi
driver turun dari ~0,5 dtk menjadi puluhan milidetik pada 3 dari 4 pengambilan.

## Belum terbukti
Keuntungan waktu di HP BELUM diukur (hanya diturunkan dari jumlah putaran jaringan yang dihapus). Bila loading masih lama,
kami butuh: (1) kapan lamanya terjadi (buka aplikasi atau login), (2) jaringan (Wi-Fi/seluler), (3) layar putih polos atau di beranda.
