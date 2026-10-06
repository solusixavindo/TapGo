# PPOB pascabayar (PLN pasca, BPJS, PDAM) — maksud jawaban Digiflazz dan rencana

Disusun 6 Okt 2026. Status (diperbarui 6 Okt 2026 siang): **BPJS dan PDAM sudah dibangun** (backend `750c548`, user_app 2.0.5+39) atas keputusan Owner di bawah. Bagian 1-4 adalah analisis awal; bagian 5 berisi keputusan dan hasilnya.

## 1. Jawaban Digiflazz dan artinya

Jawaban CS Digiflazz: API key di dashboard bisa dipakai ke semua produk, jadi tidak ada pembeda; yang berbeda hanya format request antara prabayar dan pascabayar.

Artinya:

- **Tidak ada API key khusus PDAM, dan tidak ada yang perlu "disambungkan ke semua provider".** `DIGIFLAZZ_USERNAME` dan `DIGIFLAZZ_API_KEY` yang sudah ada di server cukup untuk prabayar dan pascabayar. Tidak ada variabel lingkungan, kunci, atau pekerjaan VPS baru untuk ini.
- Yang kurang ada di **kode kita**: backend hanya mengirim format prabayar. Pascabayar memakai format lain, jadi produk pascabayar belum bisa dibeli dari TapGo.

## 2. Kondisi kode sekarang (dibaca dari `DigiflazzPpobProvider.ts`)

| Hal | Kode sekarang | Yang dibutuhkan pascabayar |
|---|---|---|
| Transaksi | `POST /transaction` dengan `buyer_sku_code`, `customer_no`, `ref_id`, `sign` (satu langkah, langsung potong) | Dua langkah: `commands: "inq-pasca"` (cek tagihan) lalu `commands: "pay-pasca"` (bayar) |
| Cek status | Kirim ulang payload yang sama | `commands: "status-pasca"` |
| Daftar harga | `cmd: "pasca"` sudah dipanggil, tetapi barisnya difilter `price > 0` | Baris pascabayar memakai `admin` dan `commission`, **tanpa `price`**; semua baris terbuang diam-diam |
| Jumlah bayar | Tetap (harga produk) | Dari hasil inquiry (tagihan berubah tiap pelanggan dan tiap bulan) |
| `ref_id` | Referensi publik transaksi | `pay-pasca` memakai `ref_id` yang sama dengan inquiry; bayar hanya sah pada tanggal yang sama dengan inquiry |

Akibatnya hari ini: sinkron harga pascabayar menghasilkan nol produk, dan bila produk pascabayar dipaksa lewat jalur prabayar, Digiflazz menolaknya. Aplikasi penumpang sudah menandai kategori ini "belum tersedia", jadi tidak ada pelanggan yang terdampak.

## 3. Rencana pembangunan (setelah keputusan Owner)

1. **Domain**: tambah `inquire(request)` ke `PpobProviderGateway` (opsional, seperti `checkStatus`), hasilnya: nama pelanggan, periode, nominal tagihan, biaya admin, total, `ref_id` inquiry.
2. **Adapter Digiflazz**: `inq-pasca`, `pay-pasca`, `status-pasca`; pembaca daftar harga pascabayar (`admin`, `commission`); pemetaan `rc` ke hasil domain; `sign` tetap `md5(username + apiKey + ref_id)`.
3. **Service dan rute**: endpoint "cek tagihan" (tanpa memotong dompet, mengikat hasil inquiry ke pengguna dan target selama masa berlaku pendek), lalu endpoint bayar yang memotong dompet dengan jalur Serializable yang sudah ada dan memanggil `pay-pasca`. Refund pada kegagalan memakai kompensasi yang sudah ada. Pending diselesaikan worker rekonsiliasi lewat `status-pasca`.
4. **Skema**: kolom/tabel kecil untuk menyimpan hasil inquiry (nominal, admin, kedaluwarsa); migrasi aditif, cadangan DB wajib sebelum terapkan.
5. **Aplikasi penumpang**: layar "masukkan ID pelanggan → tampil tagihan → konfirmasi → bayar", memakai gaya layar PPOB yang ada.
6. **Pengujian**: uji merah dulu dan uji mutasi pada jalur uang; mode `testing` Digiflazz di non-production; tidak menyentuh saldo seller nyata.
7. **Rilis**: mengikuti pola yang sama (rilis backend minimal, panduan VPS dengan blok rollback, APK uji di HP dulu).

Taksiran: satu paket kerja sendiri (backend + aplikasi), terpisah dari APK driver +14 agar APK ini tidak menunggu dan tidak membawa jalur uang baru.

## 4. Keselamatan uang (tidak diturunkan)

- Debit dompet Serializable, HMAC webhook, dan kebijakan refund yang ada tidak diubah.
- Nominal bayar selalu berasal dari inquiry yang tersimpan di server, bukan dari klien.
- Inquiry kedaluwarsa dan inquiry milik pengguna lain ditolak.

## 5. Keputusan Owner (6 Okt 2026) dan penerapannya

1. **Kategori**: BPJS dan PDAM dulu. PLN pascabayar dan lainnya sengaja belum dibuat; brand lain di Digiflazz dilaporkan oleh sinkronisasi katalog (`ignoredBrands`) supaya Owner dapat memilih.
2. **Harga**: harga Digiflazz + Rp1.000. Diterapkan sebagai `selling_price` (yang ditagihkan Digiflazz ke TapGo, setelah komisi) + Rp1.000 per pembayaran (`PPOB_POSTPAID_SERVICE_FEE`, bawaan 1000). Margin TapGo = tepat Rp1.000. Bila yang dimaksud Owner "harga resmi (`price`) + Rp1.000", margin menjadi komisi + Rp1.000; ubah satu baris di `PpobService.inquireBill`.
3. **PDAM**: tidak ada daftar dari Owner, jadi **semua PDAM yang tersedia di Digiflazz** dibuat dari daftar harga `pasca` dan dicari lewat kotak pencarian di aplikasi. Daftar nyata baru diketahui setelah `scripts/digiflazz-pasca-probe.mjs` dijalankan di VPS.
4. **Jadwal**: sekarang (selesai di sisi kode; menunggu cutover backend dan uji).

### Layanan pascabayar lain di Digiflazz (dari dokumentasi resmi)
PLN pascabayar, BPJS Kesehatan (dibuka), BPJS Ketenagakerjaan, PDAM (dibuka), Telkom (telepon), Internet pascabayar, TV kabel, HP pascabayar (Halo, XL, Indosat, Smartfren, Tri), Multifinance (angsuran kendaraan dan lainnya), PBB (pajak bumi dan bangunan), Gas (PGN/Pertagas), dan E-Money. Ketersediaan per akun dipastikan lewat skrip probe atau hasil sinkronisasi katalog.

## 6. Yang terbukti dan yang belum

- Terbukti dari pembacaan kode: format transaksi sekarang prabayar saja, dan filter `price > 0` membuang baris pascabayar.
- Terbukti (tes): alur cek-lalu-bayar, debit sekali, balapan, kedaluwarsa, refund, guard jalur harga tetap (lihat REGRESSION_REGISTER).
- Belum terbukti: bentuk respons `inq-pasca`/`pay-pasca` pada akun kita. Format permintaan mengikuti dokumentasi buyer Digiflazz (halaman test case); bidang respons dibaca dengan parser yang menolak bila angka tidak ada. Jalankan `scripts/digiflazz-pasca-probe.mjs` di VPS (hanya-baca, mode uji) dan kirim keluarannya agar dicocokkan.
