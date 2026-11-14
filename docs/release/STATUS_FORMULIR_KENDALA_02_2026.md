# Status Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 (diperbarui 14 Nov 2026)

Status jujur: "Selesai di kode" belum berarti "aktif di produksi".

| No | Permintaan | Yang dibangun | Status | Yang masih di luar kode |
|---|---|---|---|---|
| 1 | QRIS dan e-wallet | Top up: pilihan online (Midtrans) atau QRIS/transfer manual dengan konfirmasi admin. Membership: seluruhnya lewat Midtrans. Kode Midtrans menawarkan kartu, GoPay, dan QRIS. | QRIS manual selesai dan aktif. QRIS/e-wallet online: kode siap | Channel QRIS/GoPay harus aktif di akun Midtrans (hanya Owner yang dapat memeriksa di dasbor Midtrans). Channel lain (OVO, DANA, ShopeePay) belum ditawarkan kode. |
| 2 | Laporan Excel + reset akun lupa password | Ekspor CSV Data Pengguna, Data Driver, Transaksi Driver (BOM UTF-8, terbuka di Excel), SUPER_ADMIN saja, diaudit. Bantuan Akun untuk pemulihan akun. | Selesai di kode; ekspor menunggu rilis backend + admin | Berkas asli .xlsx tidak dibuat (CSV dibuka Excel). |
| 3 | Tampilkan password; status Platinum di profil | user_app +46 | Selesai di kode (APK uji di Desktop) | Uji HP Owner, lalu Play |
| 4 | Pisahkan deposit/bonus; kunci 20%; deposit dapat ditarik | Kantong saldo, kunci 20%, tarik deposit (biaya Rp2.000, min Rp50.000, 24 jam, persetujuan admin), PPOB dari Saldo TapGo, migrasi surut, tampilan web/user_app/driver_app | Selesai di kode, bendera MATI | Rilis, cadangan DB, simulasi migrasi, pemberitahuan pengguna, nyalakan bendera, jalankan migrasi surut |
| 5 | Driver tidak bisa menerima order | Alasan penolakan server tampil di lembar tawaran (sebelumnya tertutup sehingga tombol terasa mati) | Perbaikan tampilan selesai (APK driver +17) | Penyebab pasti di HP driver belum terbukti: uji APK. Kandidat: saldo di bawah Rp50.000 untuk pesanan tunai |

Risiko sisa yang disadari (tidak dapat ditutup dengan aturan tanpa merusak alur sah):
- Perjalanan palsu antara dua akun kenalan dapat memindahkan saldo terkunci menjadi saldo tarik driver. Jenis yang sama sudah ada untuk saldo top up sejak dulu; pengendalinya pemantauan admin (Transaksi Driver kini dapat diekspor), bukan aturan.
- Deposit dari top up kartu dapat ditarik setelah 24 jam; bila ada chargeback kartu kemudian, kerugian ditanggung. Pengendali: persetujuan admin atas setiap penarikan deposit.
