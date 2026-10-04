# Lembar uji lapangan driver_app — diisi Owner

Status: **BLOCKED** — belum ada satu baris pun di bawah yang diisi Owner. Tidak ada
kode, tes otomatis, atau sesi Claude yang bisa mengisi lembar ini: delapan skenario
di F1 dan tiga langkah di F2 butuh dua HP sungguhan, uang sungguhan, dan driver/
penumpang sungguhan di lapangan — di luar apa yang bisa dibuktikan dari repo.

Cara pakai: jalankan skenario secara berurutan, isi kolom **Hasil** (LOLOS/GAGAL)
dan **Catatan** langsung setelah mencoba — jangan diisi dari ingatan di akhir hari.
Setiap baris GAGAL **wajib** disalin jadi baris baru di `REGRESSION_REGISTER.md`
(format baris kosong disediakan di bagian bawah dokumen ini) sebelum lanjut ke
skenario berikutnya.

## F1. Delapan skenario wajib — dua HP, dua hari kalender berbeda

Dua HP: satu berperan **driver** (login driver_app, akun ACTIVE dengan kendaraan
terverifikasi — BUKAN akun reviewer di `DRIVER_APP_REVIEWER_TEST_ACCOUNT.md`, yang
sengaja tanpa kendaraan), satu berperan **penumpang** (login user_app). Kedua HP
dipegang Owner/orang yang Owner percaya, bukan diceritakan dari laporan driver
pilot.

**Hari 1 — Tanggal: ______________**

| # | Skenario | Langkah | Hasil (LOLOS/GAGAL) | Catatan |
|---|---|---|---|---|
| 1 | Radius 5 km | Driver online di lokasi A. Pesan dari lokasi >5 km dari A (penumpang tidak melihat driver di estimasi, atau driver tidak menerima tawaran). Pesan dari lokasi <5 km (driver menerima tawaran, jarak ke jemput tampil masuk akal). | | |
| 2 | Push saat layar mati | Driver online, kunci layar HP (layar benar-benar mati, bukan sekadar app di latar). Penumpang pesan dari dalam radius. HP driver berbunyi/bergetar dan notifikasi bisa dibuka dengan satu ketukan langsung ke tawaran. | | |
| 3 | Perjalanan penuh, peta bergerak | Terima → jemput → tiba → mulai → selesai. Selama "tiba"/"mulai", pantau peta di HP penumpang — titik driver harus bergerak mengikuti posisi sungguhan (bukan diam atau lompat). | | |
| 4 | Chat dua arah | Selama perjalanan aktif, kirim pesan dari kedua sisi. Pesan masuk memicu notifikasi/lencana di kedua HP, balas cepat tampil benar di pengirim maupun penerima. | | |
| 5 | Kedaluwarsa 3 menit | Pesan ojek TANPA ada driver online dalam radius (atau driver sengaja tidak merespons). Setelah 3 menit, status order berubah jadi tidak ada driver dan penumpang diberi tahu — tawaran basi tidak lagi muncul di HP driver mana pun. | | |
| 6 | Putus-sambung jaringan | Selama perjalanan aktif (status DRIVER_TO_PICKUP atau IN_TRIP), aktifkan mode pesawat di HP driver ±30 detik lalu matikan lagi. Aplikasi pulih sendiri (posisi/polling lanjut) tanpa perlu force-close, dan status perjalanan di HP penumpang tidak rusak/nyangkut. | | |
| 7 | Tema terang/gelap | Di kedua HP, ganti tema sistem terang↔gelap berulang (≥3 kali) saat berada di layar Beranda, Pesanan aktif, dan Chat. Tidak ada teks tak terbaca (putih di atas putih dsb.), tidak ada crash. | | |

**Hari 2 (tanggal berbeda dari Hari 1) — Tanggal: ______________**

| # | Skenario | Langkah | Hasil (LOLOS/GAGAL) | Catatan |
|---|---|---|---|---|
| 8 | Pembatalan — saldo komisi kembali SEKALI | Driver terima order TUNAI (commission belum menyala — lihat F2 bila sudah). Ulangi skenario 1-7 di atas sekali lagi secara ringkas (cukup pastikan tidak ada regresi baru dari Hari 1), lalu uji pembatalan: (a) **penumpang** membatalkan setelah driver ditugaskan, (b) di percobaan terpisah, **driver** yang membatalkan. Pada F2, saat commission sudah menyala: pastikan saldo driver kembali TEPAT sekali (bukan dua kali, bukan nol kali) — cek tab Pendapatan sebelum dan sesudah pembatalan. | | |

Kriteria lolos F1: **kedelapan skenario LOLOS, di dua hari kalender berbeda,
berturut-turut** (bila ada yang GAGAL di hari mana pun, perbaiki, lalu ulangi
SELURUH rangkaian skenario itu dari awal — bukan cuma bagian yang gagal, sesuai
aturan tetap `DRIVER_APP_READINESS_PLAN.md`).

## F2. Uang sungguhan — tiga langkah Owner

Prasyarat: `DRIVER_COMMISSION_ENABLED` **masih false** di server produksi sampai
ketiga langkah ini lolos — sesi ini tidak menyalakannya. Uji integrasi otomatis
(`driverCashCommission.integration.test.ts`, 17 skenario termasuk klaim atomic
pelepasan komisi) membuktikan LOGIKA kodenya benar, **bukan bukti transfer bank
sungguhan terjadi** — ketiga langkah di bawah adalah bukti itu, dan tidak bisa
digantikan oleh tes otomatis.

| # | Langkah | Hasil yang diharapkan | Hasil (LOLOS/GAGAL) | Catatan |
|---|---|---|---|---|
| 1 | Top up manual nominal A (mis. Rp100.000) — transfer sungguhan ke rekening TapGo, lalu konfirmasi Super Admin di konsol admin | Saldo driver bertambah TEPAT nominal A, tidak kurang/lebih | | |
| 2 | Top up manual nominal B berbeda (mis. Rp250.000), driver yang SAMA | Saldo bertambah TEPAT nominal B di atas saldo sebelumnya (A + B), bukan menimpa | | |
| 3a | Nyalakan `DRIVER_COMMISSION_ENABLED=true` **hanya di lingkungan uji/staging**, satu trip tunai SELESAI penuh | Komisi 8% tertahan (saldo berkurang) tepat saat driver MENERIMA order, BUKAN saat selesai — dan TIDAK kembali/berkurang lagi saat trip selesai (hold difinalkan, bukan dipotong kedua kali) | | |
| 3b | Satu trip tunai DIBATALKAN (oleh penumpang ATAU driver, setelah driver menerima) | Komisi yang sempat tertahan kembali ke saldo driver TEPAT SEKALI — cek baris mutasi di tab Pendapatan: harus ada pasangan HELD→RELEASED + satu REFUND, bukan dua REFUND | | |
| 3c | Satu accept SAAT SALDO KURANG dari komisi yang dibutuhkan | Permintaan ditolak dengan status 402 (Payment Required) dan pesan jelas ("Saldo TapGo Anda kurang Rp... untuk komisi...") — BUKAN error mentah/500, dan saldo driver TIDAK berubah sama sekali | | |

Kriteria lolos F2: kelima baris di atas LOLOS **tanpa selisih saldo** sama sekali
(tiap rupiah bisa ditelusuri ke baris mutasi yang jelas). Setelah F2 lolos di
staging, Owner yang memutuskan kapan menyalakan `DRIVER_COMMISSION_ENABLED=true`
di produksi — sesi ini tidak mengambil keputusan itu.

## Baris kosong untuk REGRESSION_REGISTER.md

Salin blok ini (isi semua `___`) ke tabel di `docs/release/REGRESSION_REGISTER.md`
untuk SETIAP baris GAGAL di atas, sebelum melanjutkan:

```
| 1.0.0+4 (uji lapangan ___, tanggal ___) | ___ (gejala yang dilihat) | ___ (akar masalah, isi setelah ditelusuri) | ___ (nama berkas uji penjaga yang ditambahkan) |
```

## Syarat masuk F5 (closed testing) dan F6 (rilis bertahap)

Ditulis di sini (bukan diputuskan sekarang) supaya Owner tahu persis kapan boleh
lanjut tanpa perlu menafsirkan ulang rencana:

- **F5 boleh mulai bila**: F1 di atas terisi LOLOS dua hari berturut-turut, DAN F2
  terisi LOLOS tanpa selisih saldo. Face check (F4) BOLEH tetap mati untuk closed
  testing dengan driver pilot yang dikenal langsung oleh Owner (bukan publik).
- **F6 (rilis produksi publik, bukan pilot) boleh mulai bila**: F5 selesai TANPA
  insiden kritis selama periode closed testing, DAN F3 (Play Console) terisi tanpa
  peringatan merah di pre-launch report, DAN **F4 selesai** (bukan BLOCKED) —
  verifikasi wajah dihitung ulang di server, bukan dipercaya dari klien. Rilis
  publik dengan F4 masih BLOCKED berarti akun mana pun bisa lolos verifikasi wajah
  dengan aplikasi yang dimodifikasi; itu bukan risiko yang bisa diterima di luar
  pilot yang dikenal langsung.

## Trust anchor TLS (menggantikan "pin leaf", 4 Okt 2026)

Versi sebelumnya dokumen ini mewajibkan pin SPKI leaf (`TAPGO_TLS_PIN_SHA256`) dan menyatakan bahwa
`badCertificateCallback` hanya menerima leaf. Itu **keliru**: terhadap rantai produksi callback
menerima sertifikat teratas (ISRG Root X2), sehingga pin leaf tidak pernah cocok. Mulai driver_app
1.0.0+8 aplikasi mempercayai trust anchor CA yang dibundel dan tidak lagi bergantung pada kunci leaf
atau pada nilai dari environment. Yang perlu diingat sebelum merilis: tanggal kedaluwarsa anchor dan
rencana pembaruannya — lihat `docs/release/TLS_TRUST_ANCHORS.md`.
