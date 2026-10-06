# TapGo user_app 2.0.5+40 — tagihan pascabayar lengkap (BPJS, PDAM, PLN, Telkom, internet, TV, HP, angsuran, PBB, gas, e-money)

Tanggal: 2026-10-06. Dasar: 2.0.5+39 (isi +39 tetap berlaku; +39 hanya BPJS dan PDAM). `versionCode` 40. Pin tetap trust-anchor.
Keputusan Owner 6 Okt 2026: harga ke pelanggan = harga Digiflazz + Rp1.000; BPJS dan PDAM dulu, lalu semua kategori pascabayar yang diminta Owner dibuka.

## Yang baru
- **Grup "Tagihan" di Super Menu** dengan sepuluh tile baru: PLN Pascabayar, BPJS TK, Telkom, Internet, TV Kabel,
  HP Pascabayar, Angsuran (multifinance), PBB, Gas, dan E-Money. Semuanya memakai alur yang sama dengan BPJS/PDAM.
- Kotak pencarian tampil di semua kategori yang produknya lebih dari satu; kategori berproduk tunggal langsung ke
  isian nomor. Validasi nomor ringan di aplikasi (HP pascabayar, Telkom, PBB, kontrak angsuran); aturan pasti
  ditentukan penyedia dan ditolak saat cek tagihan (belum ada uang bergerak).
- Tile **BPJS** dan **PDAM** di Super Menu kini membuka alur tagihan: pilih produk (PDAM per daerah, dengan
  kotak pencarian; BPJS langsung ke isian nomor), isi nomor pelanggan, **Cek Tagihan**, lalu **Bayar Sekarang**.
- Rincian tagihan memuat nama pelanggan, periode, tagihan, "Biaya admin & layanan", dan total. Semua angka dari
  server; aplikasi hanya mengirim referensi cek tagihan saat membayar (bukan nominal).
- Tagihan berlaku singkat (maks. 10 menit dan tidak melewati tengah malam WIB, aturan Digiflazz); setelah itu
  tombol berubah menjadi "Cek Tagihan Lagi".
- Pembayaran memakai saldo benefit PPOB (seperti pulsa dan token); saldo utama tidak terpakai.
- Mengulang bayar (jaringan putus, ketuk ganda) memakai kunci idempotensi tetap per cek tagihan: server mengenalinya
  sebagai ulangan, saldo tidak terpotong dua kali. Status "diproses" dijelaskan jujur dan diselesaikan server.
- Mode demo: produk dan tagihan contoh; bayar berakhir "dikembalikan" seperti PPOB demo lain.

## Bergantung pada backend (rilis terpisah) — penting
APK ini baru dapat dipakai **setelah**: (1) cutover backend dengan migrasi `20261006150000_ppob_postpaid_bills` dan `20261006160000_ppob_postpaid_categories`,
(2) `PPOB_PROVIDER=digiflazz` aktif dengan kredensial, (3) katalog pascabayar disinkronkan (admin
`POST /admin/ppob/sync-postpaid-catalog`, atau otomatis lewat sinkronisasi harga berkala). Tanpa itu, layar
menampilkan "<layanan> belum tersedia" (bukan galat). Kategori yang tidak ada di akun Digiflazz kita (mis. SKU tidak aktif, rc=43) tetap kosong sampai Digiflazz mengaktifkannya. Bentuk respons cek tagihan Digiflazz untuk akun kita belum
dicocokkan dengan satu respons nyata: jalankan `scripts/digiflazz-pasca-probe.mjs` di VPS (hanya-baca, mode uji).

## Terbukti dan belum
- Terbukti (tes): alur cek→bayar, nomor dibersihkan sebelum kirim, validasi 13 digit BPJS dan 6-20 digit PDAM,
  saldo kurang menonaktifkan bayar, tagihan kedaluwarsa tidak bisa dibayar, ulangan memakai kunci sama, status
  diproses/gagal tidak dinyatakan sukses, mengubah nomor membuang tagihan lama.
- **Belum terbukti:** pembayaran terhadap Digiflazz sungguhan (mode produksi), tampilan di HP.

## Catatan uji HP (belum dilakukan)
- [ ] Grup Tagihan tampil rapi di Super Menu (10 tile) dan tiap tile membuka daftar produknya.
- [ ] BPJS: isi 13 digit, Cek Tagihan, rincian wajar, Bayar (setelah backend siap).
- [ ] PDAM: cari daerah, pilih, isi ID pelanggan, Cek Tagihan, Bayar.
- [ ] Saldo PPOB kurang: tombol bayar mati dengan pesan jelas.

## Catatan jujur tentang kategori baru
Pengelompokan produk (brand/nama Digiflazz -> kategori) memakai kata kunci dan belum dicocokkan dengan daftar harga
pascabayar akun kita (probe tertahan batas `rc=83`). Brand yang tidak dikenali dilaporkan oleh sinkronisasi katalog
(`ignoredBrands`) dan tidak dibuat. Kebutuhan khusus (mis. tahun pajak pada PBB, bulan pada BPJS) belum diketahui
sampai ada respons nyata. Status per kategori baru harus dicek setelah daftar harga keluar.
