# Audit landing page tapgolion.id — 6 Okt 2026

Pemicu: pengguna gagal upgrade membership; layar menampilkan **"Failed to fetch"** setelah menekan "Lanjut ke Pembayaran".

## Akar masalah (terbukti)
Server API (`api.tapgolion.id`, nginx) menolak badan permintaan **> 1 MB (1.048.576 byte)** dengan halaman 413 yang **tanpa header CORS**.
Peramban melaporkan penolakan itu hanya sebagai `TypeError: Failed to fetch`. Foto kamera ponsel (KTP, swafoto, foto profil) hampir selalu 2-8 MB,
jadi hampir setiap pengajuan dengan foto asli gagal.

Bukti:
- `curl` ke `/api/v1/account/avatar`: 1.048.000 byte -> 401 (sampai ke aplikasi), 1.049.000 byte -> **413** tanpa `Access-Control-Allow-Origin`.
- Dari peramban pada origin `https://tapgolion.id`: 1.000.000 byte -> 401; 1.100.000 dan 3.000.000 byte -> **`TypeError: Failed to fetch`**.
- Konfigurasi di repo (`infra/nginx/tapgo-backend.conf`) menetapkan `client_max_body_size 6M` dan `docs/release/DEPLOY_VPS.md` 20M; produksi memakai bawaan nginx 1 MB (penyimpangan konfigurasi).
- Halaman memeriksa batas 5 MB (dokumen) dan 4 MB (foto profil) di sisi klien, jadi foto 1-5 MB lolos pemeriksaan klien lalu gagal di server tanpa pesan yang berarti.

## Temuan lain
1. Teks galat mentah "Failed to fetch" tampil ke pengguna pada alur upgrade dan top up (hanya dashboard mitra yang memetakannya).
2. Panel "Dokumen perlu diperbaiki" (status pesanan) tidak memeriksa jenis maupun ukuran berkas sama sekali, dan kena batas 1 MB yang sama.
3. Token akses hanya 15 menit; alur upgrade/top up membuang refresh token dan tidak menangani 401. Pengunjung yang lama mengisi formulir, atau kembali dari pembayaran Midtrans, mendapat "Token autentikasi tidak valid" tanpa jalan keluar.
4. Kegagalan unggah foto profil ditelan diam-diam (pengguna tidak pernah tahu).
5. Unggahan foto profil dashboard mitra: batas klien 4 MB, server 1 MB; kegagalan jaringan tampil sebagai "Tidak dapat terhubung" yang menyesatkan.
6. `npm run lint` gagal (komentar `eslint-disable` merujuk aturan yang tidak terpasang) — sudah dibereskan.
7. Risiko serupa di aplikasi: driver_app memperkecil foto ke 1600 px kualitas 82 (umumnya < 1 MB tetapi tidak dijamin); user_app 1024 px kualitas 82 (aman).

## Perbaikan di landing page (diuji di peramban terhadap server tiruan berbatas 1 MB tanpa CORS pada 413)
- `upgrade/image-prep.ts`: foto diperkecil di peramban (sisi terpanjang 1600 px, JPEG, kualitas turun bertahap) sampai muat 900 KB; foto kecil tidak disentuh; orientasi EXIF dihormati; PNG transparan dialasi putih. Terukur: JPEG 4,3 MB -> 199 KB, PNG 13 MB -> 370 KB, ±0,5 detik.
- Semua unggahan (dokumen, foto profil, perbaikan dokumen, avatar mitra) memakai fungsi itu.
- Galat jaringan dipetakan ke pesan Indonesia di seluruh alur (upgrade, top up, unggahan, avatar mitra); 413 yang sampai ke klien dijelaskan.
- Refresh token disimpan; permintaan berotentikasi menukar token otomatis saat 401 (sekali pakai, aman untuk permintaan serentak, 409 ditangani); bila benar-benar habis, kembali ke halaman masuk dengan pesan "Sesi Anda berakhir".
- Login 401 (password salah) tidak memicu penyegaran.
- Kegagalan foto profil kini diberitahukan di halaman pembayaran.

## Perbaikan server yang disarankan (DITUNDA atas permintaan Owner; berlaku untuk semua klien)
Di blok `server` untuk `api.tapgolion.id` pada nginx VPS, tambahkan `client_max_body_size 6M;`, lalu `nginx -t` dan `systemctl reload nginx`.
Rollback: hapus baris itu lalu reload. Setelah itu uji ulang batas 5 MB dokumen yang sudah ditegakkan backend.
Landing page yang diperbarui tetap bekerja dengan atau tanpa perubahan ini.

---

# Putaran kedua (audit lebih teliti, perbaikan langsung)

Temuan tambahan dan perbaikannya (diuji di peramban: pemeriksaan otomatis 13 rute ukuran ponsel, dan alur penuh terhadap server tiruan):

1. **Pesan galat server berbahasa Inggris tampil ke pengunjung** — terutama "Invalid phone or password" saat salah password, lalu "Account is not active", "Too many authentication attempts…", "Membership downgrade is not allowed", "Membership package is unavailable", "Membership invoice has already been paid…", dll. Kini ada pemetaan terpusat (`friendlyMessage`) untuk semua kode itu di alur upgrade, top up, dan dashboard mitra; galat server tak dikenal menjadi pesan umum Indonesia.
2. **Paket aktif atau yang lebih rendah masih bisa dipilih** padahal server menolak downgrade; kini dinonaktifkan dan diberi keterangan.
3. **Halaman status tanpa sesi buntu** (mis. kembali dari pembayaran di tab/aplikasi lain): "Masuk kembali" membawa ke langkah pilih paket, bukan status. Kini halaman diingat dan setelah masuk pengguna langsung kembali; tanpa id pengajuan, pengajuan terbaru akun ditampilkan.
4. **Halaman petunjuk transfer top up** tetap menampilkan nomor rekening dan nominal berkode unik untuk pengajuan yang sudah kedaluwarsa/dibatalkan/lunas; kini diganti penjelasan dan tombol "Buat top up baru". Label status top up "Jumlah" diganti "Nominal transfer" (nilainya sudah termasuk kode unik).
5. **SEO:** semua halaman memakai canonical ke beranda (kini per halaman; /hapus-akun menunjuk /delete-account); sitemap memuat URL tanpa garis miring (301 di Hostinger) dan /mitra yang noindex — dibereskan.
6. **ID ganda `membership`** di beranda (bagian dan artikel edukasi); artikel kini `panduan-…`.
7. **Target ketuk kecil** (tautan footer 20 px, "Bandingkan paket" dan "Tanya via WhatsApp" 24 px) — kini 44 px.
8. **Peringatan hydration React** pada elemen `<html>` (kelas dan tema diatur skrip sebelum render) — `suppressHydrationWarning`.
9. Tombol Escape kini menutup menu mobile.
10. Nomor WhatsApp di formulir daftar, kontak, dan hapus akun tidak divalidasi sama sekali; kini 9-15 digit.

Terbukti baik: tidak ada overflow horizontal, gambar rusak, gambar tanpa alt, input tanpa label, tombol/tautan tanpa nama pada 20 rute x 2 tema di lebar 375 px; harga dan manfaat paket di beranda sama dengan data paket di API produksi.

Belum diuji dengan akun sungguhan (peraturan: password tidak dimasukkan oleh asisten). Daftar uji untuk pemilik ada di laporan.
