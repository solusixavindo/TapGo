# TapGo user_app 2.0.3+30 — Tahap A: rasa aplikasi dan ojek yang lebih hidup

Tanggal: 2026-09-24. Warna dan font TIDAK diubah (keputusan Owner).

## Yang baru
- **Layar status perjalanan**: ikon per tahap, indikator langkah (Cari driver → Dijemput →
  Perjalanan → Selesai), radar berdenyut saat mencari driver, keterangan per tahap,
  dan getar halus saat driver ditemukan, tiba, selesai, atau perjalanan batal.
- **Riwayat perjalanan bisa diketuk** → Struk Perjalanan (rute, jarak, durasi, pembayaran,
  tarif, driver dan kendaraan, alasan batal) dengan **Pesan lagi** dan **Salin ringkasan**.
- **Tempat cepat** saat memesan: simpan tujuan sebagai Rumah/Kantor, dan tiga tujuan terakhir.
  Tersimpan hanya di HP (penyimpanan aman) dan dihapus saat keluar akun.
- **Skeleton loading** menggantikan spinner di Aktivitas, riwayat saldo, Chat, dan riwayat perjalanan.
- Animasi berulang otomatis mati bila "hapus animasi" aktif di pengaturan HP.

## Jaminan
- 298 tes lulus (urutan acak); tes baru mencakup langkah, radar, getar, struk, pesan lagi,
  tempat cepat, dan skeleton. Pemindai artefak lulus pada APK dan AAB.
- APK terpasang dan dijalankan di emulator (versionCode 30) tanpa crash.

## Daftar uji di HP
1. Pesan ojek: lihat radar dan langkah 1 dari 4; batalkan → tanpa indikator langkah, getar sekali.
2. Setelah driver menerima: langkah 2, keterangan "Driver sedang menuju titik jemput.", getar sekali.
3. Riwayat perjalanan → ketuk kartu → struk; **Pesan lagi** membuka pemesanan dengan rute sama.
4. Pilih tujuan → **Simpan sebagai Rumah** → keluar layar, buka lagi: chip "Rumah" muncul; keluar akun: hilang.
5. Aktivitas / Chat / riwayat saldo: skeleton tampil sebelum data.
6. Aktifkan "Hapus animasi" di pengaturan HP: radar dan skeleton tidak berkedip.
