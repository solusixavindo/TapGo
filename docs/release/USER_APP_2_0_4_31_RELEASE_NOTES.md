# TapGo user_app 2.0.4+31 — Tahap B1: posisi driver bergerak di peta

Tanggal: 2026-09-24. Warna, font, dan ikon TIDAK diubah.

## Yang baru
- Layar status perjalanan menampilkan **peta hidup** setelah driver menerima pesanan:
  titik jemput, tujuan, rute ke depan, dan **marker driver yang bergerak halus**.
- Ringkasan: "Menuju titik jemput • sekitar 4 menit • 1,2 km", lalu "Menuju tujuan • …"
  saat perjalanan berlangsung, dan "Driver sudah di titik jemput." saat tiba.
- Kamera mengikuti driver sampai Anda menggeser peta; tombol **Pusatkan** mengembalikannya.
- Bila sinyal driver terhenti > 60 detik: marker meredup dan tertulis "Menunggu sinyal terbaru dari driver…".
- Pelacakan hanya berjalan saat driver terlibat, berhenti di latar belakang dan saat perjalanan selesai.

## Keamanan dan privasi
- Endpoint baru `GET /api/v1/rides/:reference/driver-location` (sudah di produksi):
  hanya penumpang pemilik perjalanan; selain itu 404. Tidak ada identitas driver, riwayat titik,
  arah, atau kecepatan; tidak ada di luar tahap ditugaskan s.d. berlangsung; `Cache-Control: no-store`;
  dibatasi 60 permintaan per menit. 18 tes integrasi.

## Yang perlu diketahui (batasan jujur)
- **Aplikasi driver harus terbuka di layar** agar posisi terkirim. Saat ini aplikasi driver berhenti
  mengirim lokasi ketika berpindah ke aplikasi lain (mis. Google Maps) atau layar mati, karena
  belum memakai layanan latar depan (foreground service). Di kondisi itu penumpang melihat
  "Menunggu sinyal terbaru dari driver…". Solusi penuh butuh perubahan besar di aplikasi driver
  (izin lokasi latar belakang dan deklarasi Play) — direncanakan sebagai tahap terpisah.
- Aplikasi driver kini mengirim lokasi tiap 5 detik saat ada perjalanan aktif (sebelumnya 15 detik).
  Perubahan ini baru berlaku pada build aplikasi driver berikutnya.

## Daftar uji di HP (butuh satu HP driver)
1. Pesan ojek dari akun penumpang; terima dari aplikasi driver (biarkan aplikasi driver terbuka).
2. Layar status penumpang: peta muncul, marker driver bergerak, ETA dan jarak berubah.
3. Geser peta → tombol Pusatkan muncul; ketuk → kamera kembali mengikuti driver.
4. Pindahkan aplikasi driver ke latar belakang: setelah ~1 menit penumpang melihat marker redup.
5. Selesaikan perjalanan: peta hilang dan tidak ada pelacakan lagi.
