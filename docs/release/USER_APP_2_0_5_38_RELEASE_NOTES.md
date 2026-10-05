# TapGo user_app 2.0.5+38 — penilaian ala Gojek, saran tempat yang benar, bunyi, chat tanpa FCM

Tanggal: 2026-10-06. Dasar: 2.0.5+37 (isi +37 tetap berlaku). `versionCode` 38. Pin tetap trust-anchor.

## Perbaikan

### Penilaian (butir 3)
- **Error "Penilaian belum tersedia di versi layanan saat ini" — terbukti penyebabnya:** route
  `POST /rides/{ref}/rating` belum ada di proses produksi `tapgo-5588076` (backend `release/driver-rating`
  belum di-cutover). Itu pekerjaan server.
- **Halaman penilaian penuh langsung terbuka** begitu perjalanan selesai (atau saat layar dibuka ≤ 2 jam setelah
  selesai dan belum dinilai): ringkasan perjalanan, driver, bintang besar dengan label (Buruk…Luar biasa!), tag
  cepat (positif untuk 4-5 bintang, keluhan untuk 1-3), catatan, **Kirim** dan **Lewati**. Perjalanan lama dari
  riwayat tidak dibuka paksa (kartu "Beri penilaian").
- **Antrean lokal:** bila server belum punya route / jaringan putus / 5xx, penilaian disimpan di perangkat
  (penyimpanan aman, dihapus saat logout) dan dikirim ulang otomatis (90 detik; sekali setelah dashboard
  tampil). Penumpang melihat "Terima kasih! Penilaianmu akan dikirim otomatis", bukan galat merah. Setelah
  backend dirilis, antrean terkirim sendiri.

### Saran tempat (butir 4)
**Terbukti (uji langsung):** Nominatim tidak mendukung ketik-sambil-mencari ("sta", "stasi", "stasiun ser" = 0
hasil; "rumah sakit" ±3 km Serang = 0). **Photon** (awalan kata + bias lokasi) pada kasus yang sama menjawab 8
hasil relevan di empat kota.
- **Photon sebagai sumber utama** (hanya Indonesia, berbias posisi HP, diurutkan jarak haversine, maks. 8,
  label memuat wilayah); **Nominatim sebagai cadangan** bila Photon gagal/kosong.
- Saran muncul sejak **2 huruf**; jawaban usang diabaikan; pencarian tidak menunggu GPS (memakai posisi
  terakhir/cache, GPS dibaca di latar belakang lalu pencarian diulang otomatis).
- Catatan: Photon publik tidak ber-SLA; untuk produksi publik disarankan proksi backend dengan cache.

### Bunyi dan chat (butir 1-2)
- Berkas suara bawaan (`tapgo_alert.wav`, dua nada) untuk channel baru **`tapgo_alerts_v3`** dan pemutaran saat
  aplikasi di depan; layar **Akun → Uji bunyi** (izin, kategori, mode dering, volume, Jangan Ganggu, hasil
  pemutaran, Salin laporan).
- **Chat tanpa FCM:** kotak masuk chat dibaca tiap 6 detik selama ada perjalanan aktif (30 detik bila tidak):
  jumlah belum dibaca naik → popup + satu bunyi; **titik merah menetap** pada tombol "Chat dengan Driver".

## Bergantung pada backend (rilis terpisah)
- Penilaian terkirim ke server, banner penolakan dari detail order, dan bunyi notifikasi **latar belakang**
  (`channel_id` `tapgo_alerts_v3`) memerlukan cutover `release/driver-rating`.

## Catatan uji HP (belum dilakukan)
- [ ] Akun → Uji bunyi; bunyi saat aplikasi terbuka (status perjalanan berubah).
- [ ] Titik jemput: ketik "sta" lalu "stasiun" di kota Anda; saran muncul bertahap, terdekat di atas. Ulangi di
      Tujuan. GPS mati: pesan "Mencari lokasi perangkat…".
- [ ] Selesaikan perjalanan: halaman penilaian terbuka sendiri; beri bintang + tag. **Sebelum cutover:** muncul
      "akan dikirim otomatis" (bukan galat). **Setelah cutover:** buka aplikasi lagi, penilaian terkirim
      sendiri (bintang tersimpan di server).
- [ ] Chat dari driver saat layar chat tertutup: popup + bunyi + titik merah, tanpa bergantung FCM.

## Yang belum dilakukan
Belum ada uji HP. Dokumen ini tidak menyatakan aplikasi siap produksi.
