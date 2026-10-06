# PPOB pascabayar (PLN pasca, BPJS, PDAM) — maksud jawaban Digiflazz dan rencana

Disusun 6 Okt 2026. Status: **analisis dan rencana; belum ada kode PPOB yang diubah.** Pembangunan menunggu keputusan Owner di bagian 5.

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

## 5. Keputusan yang dibutuhkan dari Owner

1. **Kategori yang dibuka dulu**: PLN pascabayar, BPJS, PDAM — semua, atau mulai dari satu (saran: PLN pascabayar dulu, lalu BPJS, lalu PDAM karena PDAM per daerah dan variatif).
2. **Harga ke pelanggan**: nominal tagihan + biaya admin Digiflazz + biaya layanan TapGo berapa (tetap Rp, persen, atau hanya meneruskan komisi)? Ini menentukan pendapatan per transaksi.
3. **Produk PDAM**: daftar PDAM mana yang aktif (Digiflazz menyediakan per daerah); pilih beberapa kota utama atau semua yang tersedia.
4. **Kapan**: dikerjakan setelah APK driver +14 diuji dan Play driver berjalan, atau sebelum.

## 6. Yang terbukti dan yang belum

- Terbukti dari pembacaan kode: format transaksi sekarang prabayar saja, dan filter `price > 0` membuang baris pascabayar.
- Belum terbukti: bentuk respons `inq-pasca`/`pay-pasca` pada akun kita (perlu satu panggilan mode testing dengan kredensial server; saya tidak menjalankannya dan tidak memegang kredensial itu). Rincian bidang diambil dari dokumentasi Digiflazz dan perlu dicocokkan dengan satu respons nyata sebelum dikunci di uji.
