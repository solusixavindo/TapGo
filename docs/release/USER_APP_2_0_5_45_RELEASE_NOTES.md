# TapGo user_app 2.0.5+45 — bukti transaksi lengkap untuk semua produk Digital dan Tagihan, BPJS VA 16 digit

Tanggal: 2026-10-09. Dasar: 2.0.5+44 (isi +44 tetap berlaku: nomor token tampil, hasil Diproses memperbarui diri, satu akun satu HP, nomor HP
seluler Indonesia). `versionCode` 45. Pin tetap trust-anchor. **+44 tidak perlu diunggah**; +45 memuat semuanya.
Dasar perubahan: permintaan Owner memeriksa seluruh produk kategori Digital dan Tagihan sampai pengguna menerima bukti transaksi.

**Backend WAJIB dirilis lebih dulu** (cabang `release/driver-rating`, commit terbaru di panduan cutover): bukti tagihan membawa
`bill` dari server, dan periode tagihan hanya terbaca dengan perbaikan pembaca `periode`.

## Perubahan
1. **BPJS Kesehatan menerima nomor VA 16 digit** (dan kartu 13 digit). Sebelumnya server dan aplikasi mengunci TEPAT 13 digit padahal
   label kolom "Nomor VA BPJS" dan nomor yang dikenal pengguna 16 digit: tombol Cek Tagihan tetap mati tanpa penjelasan.
2. **Bukti pembayaran Tagihan lengkap**: nama pelanggan, periode ("Okt 2026"), tagihan, biaya admin & layanan, total, nomor transaksi,
   waktu, dan nomor referensi dari penyedia (`sn`, tersedia pada semua jenis tagihan menurut dokumentasi Digiflazz) dengan tombol salin.
3. **Bukti transaksi Digital** (Pulsa, Paket Data, Token PLN, E-Wallet): nomor transaksi dan waktu ditambahkan di kartu hasil.
4. **Layar "Bukti Transaksi"** dari Riwayat PPOB: ketuk kartu transaksi untuk melihat bukti lengkap (data dari server, tahan tutup-buka).
5. Periode di panel cek tagihan diformat sama ("Okt 2026"). Periode sebelumnya hampir selalu kosong: Digiflazz mengirim `periode`
   (tingkat atas dan `desc.detail[].periode`), kode lama membaca `period` dan jalur yang salah.

## Uji
`test/ppob_receipts_all_categories_test.dart` (16 kategori Digital dan Tagihan: nomor token/referensi, nomor transaksi, waktu, nama,
periode, rincian; Diproses; ketuk riwayat; model), `test/ppob_bill_test.dart` (VA 16 digit, bukti setelah bayar), `test/ppob_customer_test.dart`.
Backend: `tests/ppob/allCategoriesReceipt.integration.test.ts` melawan adaptor Digiflazz nyata dengan jawaban berformat dokumentasi
untuk 4 kategori prabayar dan 12 kategori pascabayar (cek tagihan -> bayar -> detail -> riwayat, hanya pemilik yang melihat nama).
Mutasi dibuktikan: tanpa perbaikan, 17 dari 19 pemeriksaan gagal. Bukti visual: aplikasi (profil web) di localhost melawan backend lokal
dan Digiflazz palsu berformat dokumentasi: BPJS VA 16 digit -> cek tagihan -> bayar -> bukti -> Riwayat -> Bukti Transaksi; Token PLN.

## Belum terbukti
Jawaban Digiflazz asli untuk tiap kategori belum pernah dilihat di produksi (hanya format dokumentasi); khususnya apakah Digiflazz menerima
nomor VA 16 digit untuk BPJS (penyedia yang menolak tetap tanpa uang bergerak). Telkom dan HP Pascabayar belum punya produk di akun
Digiflazz (tile menampilkan "belum tersedia"). Jalur native `deviceHardwareId` (+44) belum dijalankan di HP nyata.
