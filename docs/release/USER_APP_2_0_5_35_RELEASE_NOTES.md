# TapGo user_app 2.0.5+35 — pemberitahuan pencarian dilanjutkan

Tanggal: 2026-10-05. Dasar: 2.0.5+34 (trust-anchor pinning tidak diubah). `versionCode` 35.
2.0.5+33 tetap tidak boleh dipasang atau diunggah.

## Perubahan

Satu-satunya perubahan perilaku: saat seorang driver menolak tawaran dan order masih mencari driver,
penumpang diberi tahu.

- Push (butuh backend yang memuat perubahan ini): judul "Masih mencari driver", isi "Seorang driver tidak
  mengambil pesanan. Pencarian dilanjutkan."
- Di `RideStatusScreen` (aplikasi di depan): satu baris pada kartu mencari driver dengan teks yang sama.
  Status tetap "Mencari driver". Penanda dibersihkan saat push dihentikan (logout).

Fitur lain tidak diubah.

## Yang belum dilakukan

Belum ada uji HP. Push baru hanya muncul setelah backend yang memuatnya dirilis (tidak dilakukan di sini).
Unggah hanya ke track uji internal terlebih dulu.
