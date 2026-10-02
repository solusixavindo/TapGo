# Akun uji untuk reviewer Google Play — TapGo Driver

Play Console mensyaratkan akun uji yang bisa dipakai reviewer Google login sendiri tanpa pendampingan
Owner. Dokumen ini adalah instruksi untuk Owner membuat akun itu di server produksi — saya (asisten)
tidak memiliki akses untuk menjalankan perintah produksi sendiri.

## Kenapa akun ini AMAN dipakai reviewer

Skrip di bawah membuat akun dengan profil driver **ACTIVE** (bisa login dan melihat seluruh tab
aplikasi: Beranda, Pesanan, Pendapatan, Akun) **TANPA kendaraan terverifikasi**. Backend
(`RideService.listOffersForDriver` dan `notifyNearbyDrivers`) menuntut minimal satu kendaraan
`isActive=true` dan `verificationStatus=VERIFIED` sebelum driver bisa melihat ATAU menerima tawaran
apa pun. Tanpa kendaraan, reviewer bisa menekan tombol Online/Offline dengan bebas tapi **tidak akan
pernah** menerima pesanan sungguhan dari penumpang sungguhan — jadi tidak ada risiko reviewer Google
tidak sengaja mengambil order pelanggan asli selama proses review.

## Langkah (dijalankan Owner di server, lewat SSH)

```bash
cd /var/www/releases/<release-aktif>/apps/backend
read -s TAPGO_REVIEWER_PASSWORD && export TAPGO_REVIEWER_PASSWORD
npm run driver:reviewer-bootstrap -- \
  --phone 08XXXXXXXXXX \
  --full-name "Google Play Reviewer" \
  --confirm-reviewer-bootstrap
```

- Ganti `08XXXXXXXXXX` dengan nomor HP KHUSUS untuk akun ini — jangan pakai nomor pribadi Owner atau
  nomor yang sedang dipakai akun lain.
- Password diketik saat `read -s` meminta (tidak tampil di layar, tidak tersimpan di shell history).
- Skrip aman dijalankan berulang: menjalankannya lagi dengan nomor yang sama akan mereset password
  akun yang sama, bukan membuat akun duplikat.

## Yang diisi di Play Console (App content > App access)

- **Username/nomor HP**: nomor yang dipakai di atas.
- **Password**: password yang di-set lewat `TAPGO_REVIEWER_PASSWORD`.
- **Instructions for reviewer** (salin ke kolom instruksi):

  > Login dengan nomor HP dan password yang diberikan. Aplikasi ini khusus untuk mitra pengemudi
  > TapGo yang sudah terverifikasi. Akun uji ini bisa login dan menjelajahi seluruh tab aplikasi
  > (Beranda, Pesanan, Pendapatan, Akun), termasuk mengaktifkan status Online/Offline. Akun ini
  > sengaja tidak memiliki kendaraan terverifikasi sehingga tidak akan menerima pesanan sungguhan —
  > ini untuk melindungi penumpang asli selama proses review, bukan keterbatasan aplikasi.

## Jangan lupa

- **Jangan** mencantumkan nomor/password ini di listing publik atau file mana pun yang ikut
  ter-commit ke repository. Simpan hanya di form Play Console dan (opsional) password manager Owner.
- Setelah review selesai dan aplikasi live, akun ini boleh dibiarkan (tidak berbahaya, tidak pernah
  menerima order) atau dinonaktifkan lewat `admin:driver-status` bila Owner ingin membersihkannya.
