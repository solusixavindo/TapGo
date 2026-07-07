# Jawaban Klarifikasi Merchant DOKU

Dokumen ini disiapkan untuk menjawab permintaan klarifikasi DOKU terkait flow bisnis, layanan pembayaran yang digunakan, target pengguna, dan status aplikasi TapGo.

## A. Identitas Merchant

| Informasi | Detail |
| --- | --- |
| Nama perusahaan | PT TAPGO LION INDONESIA |
| Brand aplikasi | TapGo |
| Email support | support@tapgolion.id |
| Website | https://tapgolion.id |
| Direktur | Ahmad Zulhi |
| Ticket DOKU | #1101182 |

## B. Flow Bisnis TapGo

Flow transaksi TapGo dari customer melakukan pemesanan sampai transaksi selesai adalah sebagai berikut:

1. Customer melakukan registrasi akun TapGo.
2. Customer login ke aplikasi TapGo.
3. Customer memilih paket membership digital.
4. Customer masuk ke halaman checkout.
5. Sistem TapGo membuat invoice.
6. Customer menekan tombol bayar.
7. Sistem TapGo mengarahkan customer ke halaman pembayaran DOKU.
8. Customer memilih metode pembayaran yang tersedia.
9. Setelah pembayaran berhasil, DOKU mengirim notifikasi atau webhook ke backend TapGo.
10. Backend TapGo memverifikasi status pembayaran.
11. Invoice berubah menjadi `PAID`.
12. Membership customer aktif otomatis.
13. Benefit membership dan hak usaha aktif sesuai paket yang dibeli.

Ringkasan flow:

```text
Registrasi/Login -> Pilih Membership -> Checkout -> Invoice
-> DOKU Checkout -> Pembayaran Berhasil -> Webhook DOKU
-> Verifikasi Backend TapGo -> Invoice PAID -> Membership Aktif
```

## C. Produk yang Dijual

Objek transaksi yang diproses melalui DOKU adalah paket membership digital TapGo.

| Paket | Harga | Keterangan |
| --- | ---: | --- |
| Basic | Gratis | Akses dasar aplikasi TapGo |
| Silver | Rp500.000 | Paket membership berbayar |
| Gold | Rp3.000.000 | Paket membership berbayar |
| Platinum | Rp5.500.000 | Paket membership berbayar |

Penegasan:

- TapGo tidak menjual produk ilegal.
- TapGo tidak memproses pinjaman atau kredit.
- TapGo tidak menyimpan data kartu customer.
- TapGo menggunakan payment gateway resmi untuk transaksi pembayaran membership.
- Status membership hanya diaktifkan setelah backend TapGo menerima dan memverifikasi notifikasi pembayaran yang valid.

## D. Layanan DOKU yang Digunakan

Layanan DOKU yang akan digunakan oleh TapGo adalah:

- DOKU Checkout sebagai payment gateway utama TapGo v1.0.
- Hosted payment page DOKU, sehingga customer diarahkan ke halaman pembayaran DOKU.
- Payment notification/webhook DOKU untuk validasi status pembayaran di backend TapGo.

Jenis pembayaran yang ingin digunakan melalui DOKU:

- Virtual Account.
- QRIS.
- E-Wallet.
- Bank Transfer.
- Payment Link / Checkout Page jika tersedia pada layanan merchant TapGo.

## E. Target Pengguna TapGo

Target pengguna/customer TapGo adalah:

- Masyarakat umum pengguna aplikasi mobile.
- Calon member TapGo.
- Komunitas, mitra, dan pengguna layanan digital.
- Pengguna yang ingin membeli membership dan menggunakan layanan TapGo seperti wallet, referral, PPOB, serta layanan digital lain dalam ekosistem TapGo.

## F. Status Aplikasi

Status aplikasi TapGo saat ini:

- Aplikasi TapGo sedang dalam tahap pre-production / release preparation.
- Google Play production release sedang disiapkan.
- Aplikasi belum dipublikasikan secara penuh ke Google Play karena TapGo sedang menyelesaikan verifikasi payment gateway dan production readiness.
- Website resmi TapGo tersedia di: https://tapgolion.id

Jika DOKU membutuhkan akses demo/UAT atau screenshot tambahan, PT TAPGO LION INDONESIA dapat menyediakan lampiran tambahan sesuai kebutuhan review.

## G. Lampiran yang Direkomendasikan

Lampiran yang dapat disertakan untuk mendukung proses klarifikasi dan verifikasi DOKU:

- NIB beserta lampiran KBLI.
- Company profile / merchant onboarding document.
- Screenshot flow aplikasi.
- Screenshot halaman checkout.
- Screenshot payment page DOKU jika tersedia.
- SK Kemenkumham.
- NPWP.

## H. Draft Email Balasan untuk DOKU

Subject: Klarifikasi Flow Bisnis dan Penggunaan Layanan DOKU - PT TAPGO LION INDONESIA - Ticket #1101182

Kepada Tim DOKU,

Terima kasih atas konfirmasi dan permintaan klarifikasi terkait merchant PT TAPGO LION INDONESIA untuk ticket #1101182.

Berikut kami sampaikan ringkasan jawaban atas pertanyaan yang diminta:

1. Flow bisnis TapGo dimulai dari customer melakukan registrasi/login, memilih paket membership digital, masuk ke halaman checkout, sistem membuat invoice, customer menekan tombol bayar, kemudian customer diarahkan ke halaman pembayaran DOKU. Setelah pembayaran berhasil, DOKU mengirimkan notifikasi/webhook ke backend TapGo untuk diverifikasi. Setelah pembayaran valid, invoice berubah menjadi PAID dan membership customer aktif otomatis.

2. Layanan DOKU yang akan digunakan adalah DOKU Checkout sebagai payment gateway utama TapGo v1.0. Customer akan diarahkan ke hosted payment page DOKU. Jenis pembayaran yang ingin digunakan meliputi Virtual Account, QRIS, E-Wallet, Bank Transfer, serta Payment Link / Checkout Page jika tersedia.

3. Target pengguna TapGo adalah masyarakat umum pengguna aplikasi mobile, calon member TapGo, komunitas, mitra, dan pengguna layanan digital yang ingin membeli membership serta menggunakan layanan TapGo seperti wallet, referral, PPOB, dan layanan digital lain.

4. Aplikasi TapGo saat ini berada pada tahap pre-production / release preparation. Google Play production release sedang disiapkan dan belum dipublikasikan penuh karena TapGo sedang menyelesaikan proses verifikasi payment gateway dan production readiness. Website resmi TapGo dapat diakses melalui https://tapgolion.id.

Sebagai penegasan, objek transaksi yang diproses melalui DOKU adalah paket membership digital TapGo, yaitu Silver Rp500.000, Gold Rp3.000.000, dan Platinum Rp5.500.000. TapGo tidak menjual produk ilegal, tidak memproses pinjaman/kredit, dan tidak menyimpan data kartu customer. Pembayaran membership diproses melalui payment gateway resmi dan status membership hanya aktif setelah pembayaran terverifikasi oleh backend TapGo.

Kami juga melampirkan dokumen pendukung berisi flow bisnis, produk yang dijual, layanan DOKU yang digunakan, target pengguna, dan status aplikasi TapGo.

Apabila Tim DOKU memerlukan dokumen tambahan seperti NIB, NPWP, SK Kemenkumham, screenshot checkout, atau screenshot payment page, kami siap melengkapi sesuai kebutuhan proses review.

Hormat kami,

PT TAPGO LION INDONESIA  
Ahmad Zulhi  
Direktur  
Email: support@tapgolion.id  
Website: https://tapgolion.id

## I. Catatan Internal

- DOKU adalah primary payment gateway TapGo v1.0.
- Midtrans tetap disiapkan sebagai secondary/fallback sambil menunggu review.
- Xendit tidak digunakan dalam TapGo v1.0.
- Tidak ada credential payment gateway yang dicantumkan dalam dokumen ini.
- Dokumen ini tidak mengubah flow payment, source code, database, deployment, atau konfigurasi production.
