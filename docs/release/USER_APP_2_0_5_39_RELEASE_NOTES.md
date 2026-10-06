# TapGo user_app 2.0.5+39 — tagihan BPJS dan PDAM (pascabayar)

Tanggal: 2026-10-06. Dasar: 2.0.5+38 (isi +38 tetap berlaku). `versionCode` 39. Pin tetap trust-anchor.
Keputusan Owner 6 Okt 2026: buka BPJS dan PDAM dulu; harga ke pelanggan = harga Digiflazz + Rp1.000.

## Yang baru
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
APK ini baru dapat dipakai **setelah**: (1) cutover backend dengan migrasi `20261006150000_ppob_postpaid_bills`,
(2) `PPOB_PROVIDER=digiflazz` aktif dengan kredensial, (3) katalog BPJS/PDAM disinkronkan (admin
`POST /admin/ppob/sync-postpaid-catalog`, atau otomatis lewat sinkronisasi harga berkala). Tanpa itu, layar
menampilkan "BPJS/PDAM belum tersedia" (bukan galat). Bentuk respons cek tagihan Digiflazz untuk akun kita belum
dicocokkan dengan satu respons nyata: jalankan `scripts/digiflazz-pasca-probe.mjs` di VPS (hanya-baca, mode uji).

## Terbukti dan belum
- Terbukti (tes): alur cek→bayar, nomor dibersihkan sebelum kirim, validasi 13 digit BPJS dan 6-20 digit PDAM,
  saldo kurang menonaktifkan bayar, tagihan kedaluwarsa tidak bisa dibayar, ulangan memakai kunci sama, status
  diproses/gagal tidak dinyatakan sukses, mengubah nomor membuang tagihan lama.
- **Belum terbukti:** pembayaran terhadap Digiflazz sungguhan (mode produksi), tampilan di HP.

## Catatan uji HP (belum dilakukan)
- [ ] BPJS: isi 13 digit, Cek Tagihan, rincian wajar, Bayar (setelah backend siap).
- [ ] PDAM: cari daerah, pilih, isi ID pelanggan, Cek Tagihan, Bayar.
- [ ] Saldo PPOB kurang: tombol bayar mati dengan pesan jelas.
