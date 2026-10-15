# Analisis: penumpang membayar biaya top up penuh (16 Oktober 2026)

Pertanyaan Owner: penumpang sekarang membayar biaya penuh seperti PPOB (VA Rp4.440). Apakah user/driver akan batal top up karena biaya
besar, dan kebijakan apa yang menguntungkan user, driver, dan perusahaan sekaligus.

## 1. Fakta sistem yang menentukan jawabannya
1. **Penumpang tidak butuh saldo untuk memesan.** Pesanan tunai selalu tersedia. Perusahaan tetap menerima komisi 8% dari pesanan tunai
   (ditahan dari Saldo TapGo driver). Jadi top up penumpang bukan syarat pendapatan komisi; ia hanya kenyamanan (bayar digital) dan float.
2. **Driver butuh saldo untuk pesanan tunai.** Tanpa Saldo TapGo >= komisi 8%, tawaran tunai ditolak. Top up driver adalah pembuka pendapatan
   driver dan perusahaan, bukan sekadar kenyamanan.
3. **Saldo TapGo hanya terpakai untuk** (berdasarkan pemeriksaan kode): bayar perjalanan digital, komisi tunai driver, dan transfer antar-akun. PPOB memakai Saldo PPOB yang
   terpisah. Jadi top up Saldo TapGo hampir selalu berakhir sebagai komisi (8% dari tarif) bila dipakai di perjalanan.
4. Saldo hasil top up tidak dapat ditarik (hanya `balance`, bukan `cashBalance`). Subsidi biaya karenanya tidak bisa diubah menjadi uang tunai lewat penyalahgunaan.
5. Biaya Midtrans per metode: VA bank Rp4.000 + PPN = **Rp4.440 tetap**; QRIS **0,7%**; GoPay 2%; DANA 1,5% + PPN. Yang aktif sekarang hanya VA.

## 2. Biaya yang dirasakan pelanggan (per nominal top up)

| Nominal | VA penuh | VA dibatasi Rp2.500 | QRIS 0,7% | GoPay 2% | Komisi 8% bila seluruhnya dipakai di perjalanan |
|---|---|---|---|---|---|
| Rp25.000 | Rp4.440 (17,8%) | Rp2.500 (10,0%) | Rp177 (0,7%) | Rp511 (2,0%) | Rp2.000 |
| Rp50.000 | Rp4.440 (8,9%) | Rp2.500 (5,0%) | Rp353 (0,7%) | Rp1.021 (2,0%) | Rp4.000 |
| Rp100.000 | Rp4.440 (4,4%) | Rp2.500 (2,5%) | Rp705 (0,7%) | Rp2.041 (2,0%) | Rp8.000 |
| Rp200.000 | Rp4.440 (2,2%) | Rp2.500 (1,3%) | Rp1.410 (0,7%) | Rp4.082 (2,0%) | Rp16.000 |
| Rp500.000 | Rp4.440 (0,9%) | Rp2.500 (0,5%) | Rp3.525 (0,7%) | Rp10.205 (2,0%) | Rp40.000 |

Titik impas VA lawan QRIS ada di sekitar Rp634.000: di bawah itu QRIS selalu lebih murah. Titik impas subsidi: perusahaan menanggung
Rp1.940 (Rp4.440 - Rp2.500) per top up dan baru kembali bila saldo itu dipakai untuk perjalanan senilai >= **Rp24.250** (Rp1.940 / 8%).

## 3. Jawaban atas kekhawatiran

**Driver.** Risiko batal top up ada, tetapi nilainya kecil terhadap yang dibuka: Rp25.000 membuka komisi untuk pesanan tunai senilai ~Rp312.000,
dan driver membayar Rp2.500 (0,8% dari tarif yang dibuka). Perusahaan menanggung Rp1.940 dan memperoleh ~Rp25.000 komisi dari saldo yang sama
bila saldo terpakai penuh. Kebijakan driver sekarang (batas Rp2.500, Rp50.000 dipilihkan, Rp25.000 tetap ada) sehat dan **dipertahankan**.
Halaman top up kini menuliskan kapasitas itu ("Saldo Rp50.000 cukup untuk komisi 8% pesanan tunai senilai sekitar Rp625.000") agar driver
membandingkan biaya dengan pendapatan yang dibuka, bukan dengan nominal top up.

**Penumpang.** Biaya penuh Rp4.440 pada Rp25.000 (17,8%) hampir pasti membuat sebagian besar penumpang memilih tunai. Itu **tidak merugikan
pendapatan komisi** (tunai tetap berkomisi), tetapi mengurangi adopsi bayar digital dan float. Menanggung biaya penumpang secara menyeluruh
tidak dianjurkan: pada Rp25.000 yang dipakai penuh di perjalanan perusahaan hanya impas (+Rp60), dan penumpang yang top up lalu tidak
memakainya (atau sekadar memindahkannya antar-akun) menjadi kerugian murni Rp1.940 per top up.

## 4. Pilihan kebijakan dan perhitungannya

| Opsi | Penumpang bayar | Perusahaan menanggung | Penilaian |
|---|---|---|---|
| A. Sekarang: penumpang bayar VA penuh | Rp4.440 | Rp0 | Aman, tapi top up kecil nyaris tidak mungkin; adopsi digital rendah |
| B. Batas Rp2.500 untuk semua penumpang | Rp2.500 | Rp1.940 tiap top up | Impas hanya bila saldo terpakai >= Rp24.250 di perjalanan; rugi pada top up kecil yang diam |
| C. **Aktifkan QRIS (0,7%) dan jadikan pilihan pertama** | Rp177 pada Rp25.000 | Rp0 | Biaya penumpang turun 96% tanpa biaya perusahaan; syarat: aktivasi di Midtrans |
| D. Batas Rp2.500 hanya untuk top up penumpang >= Rp100.000 (VA) | Rp4.440 di bawah Rp100.000; Rp2.500 di atasnya | Rp1.940 hanya pada top up besar | Mendorong top up besar (lebih sedikit transaksi); komisi yang dibuka >= Rp8.000, jauh di atas Rp1.940 |
| E. Gratis semua | Rp0 | Rp4.440 tiap top up | Tidak dianjurkan |

## 5. Rekomendasi (menguntungkan ketiga pihak)

1. **Pertahankan** kebijakan driver: batas Rp2.500, Rp25.000 tetap ada, Rp50.000 dipilihkan. Perusahaan menanggung selisih, dan itu dibayar
   komisi dari saldo yang sama.
2. **Prioritas utama: aktifkan QRIS (GoPay QRIS / `other_qris`) di dasbor Midtrans** dan tampilkan lebih dulu pada halaman top up. Ini satu-satunya
   langkah yang menurunkan biaya untuk penumpang DAN driver tanpa biaya bagi perusahaan. Setelah aktif: tambahkan kode Snap ke
   `MIDTRANS_ENABLED_PAYMENTS` dan `qris` ke `WALLET_TOPUP_METHODS` (dua-duanya, dalam satu restart). GoPay (2%) menyusul, DANA bila sudah aktif.
3. **Opsi D untuk penumpang** (batas Rp2.500 hanya bila top up >= Rp100.000): perubahan kecil di `customerTopUpFee` (satu ambang). Perusahaan
   hanya menanggung bila penumpang memilih VA pada nominal besar, dan komisi yang dibuka (>= Rp8.000) menutup subsidi Rp1.940 empat kali lipat.
   Opsi ini saya anjurkan **setelah** QRIS aktif dan setelah ada data nyata (lihat bagian 6); sekarang belum perlu dikode.
4. ~~Jangan menanggung biaya top up PPOB~~ (rekomendasi awal saya: margin bersih pulsa/tagihan hanya Rp500 sampai Rp1.000). **Diputuskan Owner 16 Okt 2026: batas Rp2.500 berlaku untuk SEMUA nominal Saldo PPOB**, selisih ditanggung perusahaan. Lihat bagian 7.
5. Dorong driver menggunakan **perjalanan digital**: komisi dipotong langsung dari tarif (92% masuk saldo), sehingga driver yang menerima
   banyak pesanan digital hampir tidak perlu top up sama sekali. Ini pengurang biaya terbesar dalam jangka panjang.
6. Tanyakan penawaran biaya VA dari Midtrans untuk volume Anda, dan bandingkan dengan DOKU (kode integrasinya sudah ada di backend).
   Saya tidak mengetahui tarif DOKU saat ini; angka itu harus datang dari mereka.

## 6. Data nyata sebelum memutuskan opsi D (hanya baca)

Jalankan di database produksi (aman, hanya SELECT). Hasilnya menunjukkan berapa persen top up yang dibuat benar-benar dibayar, per jenis
akun dan metode. Bila persen dibayar penumpang jauh di bawah driver, biaya adalah penyebabnya dan opsi C/D layak didahulukan.

```sql
SELECT
  CASE WHEN dp.id IS NOT NULL THEN 'DRIVER' ELSE 'PENUMPANG' END AS akun,
  o.metadata->>'target' AS tujuan,
  COALESCE(o.metadata->>'method', 'bank_transfer') AS metode,
  COUNT(*) AS dibuat,
  COUNT(*) FILTER (WHERE o.status = 'PAID') AS dibayar,
  ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = 'PAID') / COUNT(*), 1) AS persen_dibayar,
  COUNT(*) FILTER (WHERE o.status IN ('EXPIRED', 'CANCELLED', 'FAILED')) AS kedaluwarsa_batal_gagal,
  ROUND(AVG((o.metadata->>'baseAmount')::numeric)) AS rata2_nominal
FROM wallet_topup_orders o
LEFT JOIN ride_driver_profiles dp ON dp.user_id = o.user_id
WHERE o.created_at > now() - interval '30 days'
  AND o.metadata->>'grossAmount' IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;
```

Catatan batas analisis: saya tidak punya data konversi nyata (top up online baru aktif 13-14 Oktober), jadi dugaan "penumpang memilih tunai" adalah
penalaran dari struktur biaya, bukan pengukuran. Angka rata-rata tarif perjalanan yang dipakai di tabel adalah asumsi (komisi dihitung dari
nominal top up penuh, bukan dari rata-rata tarif).

## 7. Keputusan Owner: Saldo PPOB dibatasi Rp2.500 untuk semua nominal (16 Okt 2026)

Berlaku untuk semua pelanggan (`PPOB_TOPUP_FEE_CAP`, bawaan 2500; mengubah ke 4440 atau lebih mengembalikan biaya penuh tanpa kode baru).
Biaya tidak pernah ditagih lebih dari biaya sebenarnya, jadi QRIS (Rp177 pada Rp25.000) tetap murah.

Risiko yang diterima dengan sadar: VA menghabiskan Rp1.940 bagi perusahaan per top up, sedangkan margin PPOB hanya Rp500 (prepaid) atau
Rp1.000 (pascabayar) per transaksi. Top up Rp25.000 yang dipakai untuk satu pulsa rugi sekitar Rp1.440; baru impas sekitar 4 transaksi prepaid
per top up. Beban ini otomatis tercatat di Laba Rugi sebagai biaya gateway (biaya sebenarnya dikurangi biaya pelanggan).

Pengamanan: (1) aktifkan QRIS lalu tampilkan lebih dulu, karena biaya perusahaan jadi nol di bawah Rp2.500; (2) jalankan query bagian 6
setelah 2-4 minggu, tambahkan kolom jumlah transaksi PPOB per pengguna bila perlu, dan bandingkan beban gateway di Laba Rugi dengan margin PPOB;
(3) bila beban melebihi margin, naikkan `PPOB_TOPUP_FEE_CAP` atau beri ambang nominal.
