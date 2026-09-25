# TapGo user_app 2.0.5+32 — perbaikan tampilan dan notifikasi push

Tanggal: 2026-09-25. Dasar: hasil uji HP pada 2.0.4+31.

## Perbaikan tampilan (dari uji HP Owner)
1. **Tombol/kolom cari dihapus** dari Beranda (fungsinya hanya membuka Kartu Anggota, yang tetap ada di grid layanan dan menu Akun). Kode pendukungnya ikut dihapus.
2. **Ikon Ubah Password** kini ilustrasi 3D satu gaya dengan menu Akun lainnya (gembok biru dengan lencana emas), bukan ikon datar.
3. **Latar tema terang** tidak lagi hampir putih: dari `#F4F8FB` menjadi `#E8EFF6`, sehingga kartu putih terlihat terangkat. Teks sekunder digelapkan (`#94A3B8` menjadi `#64748B`) agar kontras tetap >= 4:1.
4. **Aktivitas**: kartu diringkas menjadi judul + satu baris "status • tanggal" (+ nominal). Tinggi kartu dari ~90 menjadi ~62 dp. Nomor tujuan/alamat tidak lagi ditampilkan di daftar. Kartu dan keadaan kosong kini mengikuti tema (tidak lagi kotak putih di tema gelap). Tanda centang filter menjadi putih.

## Perbaikan galat "Terjadi gangguan tampilan" saat ganti tema
- Akar masalah: grid layanan di Beranda menghitung lebar sel negatif saat sesaat mendapat lebar ~0, sehingga
  membangun kotak berlebar negatif. Diperbaiki (lebar dijepit >= 0) dan dijaga uji regresi.
- Diverifikasi di emulator: buka Tampilan, ganti terang/gelap enam kali, konsol bebas galat.

## Server (produksi, butuh langkah Owner)
- `MOBILE_LEGACY_CLIENT_BLOCK_ENABLED=true` + `MOBILE_MIN_APP_BUILD=32`: build user_app di bawah 2.0.5+32
  ditolak 426 dengan pesan memperbarui dari Google Play.
- Akun ber-peran ADMIN/SUPER_ADMIN/SUPER_ADMIN_VIP ditolak 403 `ADMIN_WEB_ONLY` dari klien mobile.
- Founder Program: tidak ada satu pun jejaknya di user_app, driver_app, maupun APK (dipindai).

## Chat penumpang-driver (baru di 2.0.5)
- Tab **Chat** kini kotak masuk: bagian **Perjalanan** (percakapan dengan driver, pesan terakhir, lencana pesan belum dibaca)
  dan bagian **Bantuan TapGo** (tiket bantuan seperti sebelumnya). Ikon tab Chat menampilkan lencana jumlah pesan baru.
- **Notifikasi "Pesan baru dari driver/penumpang"** (tanpa isi pesan), maksimal satu per 20 detik per percakapan.
  Mengetuknya membuka layar chat.
- **Balasan cepat** satu ketukan: "Saya sudah di titik jemput", "Tunggu sebentar ya", "Saya di seberang jalan", "Terima kasih".
- **Pintasan chat di Beranda** selama perjalanan berjalan: strip tipis "Chat dengan driver" (tanpa pesan baru) atau kartu
  menonjol dengan lencana, cuplikan pesan, dan dua balasan cepat (ada pesan baru dari driver). Tidak tampil bila tidak ada perjalanan berjalan.
- Aturan waktu: bisa membalas selama perjalanan dan 2 jam setelah selesai; bisa dibaca 7 hari; setelah itu hilang dari kotak masuk.
  Percakapan yang sudah tertutup tampil dengan ikon kunci dan tanpa kolom tulis.
- Perbaikan tersembunyi: pesan baru kini muncul lewat polling tiap 4 detik (Socket.IO nonaktif di produksi sehingga
  sebelumnya pesan masuk tidak tampil sampai layar dibuka ulang); pesan yang dikirim lewat REST kini tampil di layar pengirim;
  socket dibatasi 3 kali percobaan sambung ulang; gelembung chat mengikuti tema gelap.
- Notifikasi chat ke **driver** butuh Firebase di aplikasi driver (belum dipasang); sisi penumpang sudah lengkap.
- Server: endpoint baru `GET /api/v1/chat/conversations`; **wajib di-deploy** agar tab Chat menampilkan kotak masuk.

## Notifikasi push (FCM) — baru
- Aplikasi meminta izin notifikasi setelah masuk dan mendaftarkan token perangkat; token dicabut saat keluar, sesi berakhir, atau ganti password.
- Backend (sudah di produksi) mengirim: driver ditemukan / tiba / perjalanan selesai / dibatalkan driver; transfer masuk; top up berhasil; pembayaran, aktivasi, dan penolakan dokumen membership. Teks tanpa nominal, nama, atau alamat.
- Mengetuk notifikasi perjalanan membuka layar status perjalanan tersebut.
- **Untuk Play Console**: isi Data safety dengan "Device or other IDs" (token FCM) dan perbarui kebijakan privasi untuk menyebut notifikasi.

## Lain-lain
- Izin baru: `POST_NOTIFICATIONS` (Android 13+). Channel notifikasi: `tapgo_default`.
- Chat penumpang-driver ada di layar status perjalanan (tombol "Chat dengan Driver"), muncul setelah driver menerima pesanan. Tab "Chat" di bawah adalah percakapan bantuan dengan tim TapGo.

## Daftar uji di HP
1. Beranda: tidak ada kolom cari; latar terang terlihat biru keabuan; kartu putih tampak terangkat.
2. Akun: ikon Ubah Password sama gayanya dengan Profil/Kartu Anggota (terang dan gelap).
3. Aktivitas (terang dan gelap): kartu ringkas, tidak ada kotak putih di tema gelap.
4. Izin notifikasi muncul setelah masuk (Android 13+); tolak dan izinkan sama-sama tidak membuat aplikasi rusak.
5. Uji push: lakukan transfer ke akun kedua atau pesan ojek dan terima dari aplikasi driver; notifikasi muncul di HP penumpang.
