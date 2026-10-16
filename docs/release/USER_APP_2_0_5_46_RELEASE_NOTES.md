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

Sisi server (rilis backend `tapgo-<sha>` berikutnya): estimasi rute pelacakan dipakai ulang 5 dtk per pesanan, jadi jawaban posisi
driver turun dari ~0,5 dtk menjadi puluhan milidetik pada 3 dari 4 pengambilan.

## Belum terbukti
Keuntungan waktu di HP BELUM diukur (hanya diturunkan dari jumlah putaran jaringan yang dihapus). Bila loading masih lama,
kami butuh: (1) kapan lamanya terjadi (buka aplikasi atau login), (2) jaringan (Wi-Fi/seluler), (3) layar putih polos atau di beranda.
