# TapGo Driver 1.0.0+16 — Fase 1 produksi langsung

Tanggal: 2026-10-16. Menggantikan 1.0.0+15 (isi +15 tetap berlaku). `versionCode` 16. Pin tetap trust-anchor.
Fase 1: publish pertama langsung ke produksi dengan komisi 8% pesanan tunai (lihat `DRIVER_APP_FASE1_PRODUKSI_LANGSUNG.md`).
Berpasangan dengan backend `tapgo-c3b62f4` (sudah aktif di produksi); komisi baru menyala setelah uji top up nyata lolos.

## Yang baru
1. **Lembar tawaran**: hitung mundur jujur dari batas pencarian server, rincian tarif/komisi/pendapatan bersih (tunai: komisi
   8% ditahan dari Saldo TapGo; digital: dipotong dari tarif), tombol Terima/Tolak dipasang tetap di bawah.
2. **Posisi lebih cepat**: lokasi dikirim tiap 1 dtk saat menuju/menunggu penumpang, 2 dtk saat mengantar, 15 dtk saat idle;
   GPS mode cepat hanya saat menuju titik jemput; kiriman tidak menumpuk saat jaringan lambat.
3. **Pernyataan Kemitraan** 10 bagian (hak/kewajiban, risiko perjalanan, penyelewengan dan sanksi, komisi, data pribadi) sebagai
   LANGKAH PERTAMA pendaftaran; persetujuan terkunci sampai naskah digulir habis; versi naskah dikirim dan dicatat di audit;
   halaman baca ulang di Akun > Bantuan.
4. **Akun > Password tapgolion.id**: akun Google dapat membuat password untuk isi Saldo TapGo di web.
5. **Saldo segar**: saldo dimuat ulang saat kembali dari peramban setelah isi saldo, dan tarik layar di tab Pendapatan.

6. **Saldo minimal menerima pesanan tunai** (Rp50.000, dihitung sebelum komisi ditahan; ditegakkan server); batasnya tertulis di
   catatan kartu saldo tab Pendapatan. Tanpa banner peringatan saldo (keputusan Owner). Pernyataan versi 2026-10-16.2.
   Berpasangan dengan backend yang memuat `DRIVER_MIN_CASH_BALANCE` (env produksi: 50000).

7. **Buka aplikasi lebih cepat**: perjalanan aktif tidak lagi dibaca dua kali berturut-turut saat membuka aplikasi (pemeriksaan
   sesi dan pemuatan ruang kerja memakai satu permintaan). Satu putaran jaringan lebih sedikit sebelum beranda tampil.

## Fase 2 (ikut rilis pertama)
8. **Penilaian penumpang**: rata-rata bintang di kartu Performa (tab Pendapatan) dan layar "Penilaian penumpang" (sebaran bintang,
   ulasan terbaru). Identitas penumpang tidak pernah dikirim. Belum ada penilaian = "Belum ada", bukan 0,0.
9. **Driver menilai penumpang** setelah perjalanan selesai (1-5 bintang + catatan, boleh dilewati). Hanya dilihat tim TapGo.
10. **Pusat Bantuan** (Akun > Bantuan): 8 pertanyaan umum (komisi, saldo minimal, isi saldo, penarikan, SOS, verifikasi wajah,
    tawaran tidak muncul, pembatalan) dan "Tanya TapGo" (tiket dengan balasan tim).
11. **Insentif harian**: kartu "Insentif hari ini" di tab Pendapatan (target perjalanan, kemajuan, bonus). Bonus otomatis masuk ke
    saldo yang dapat ditarik SETELAH diverifikasi (paling lama 24 jam; hanya perjalanan nyata yang dihitung) dan tampil di riwayat
    saldo. Aturan diatur Super Admin di konsol (Keuangan > Insentif Driver); tanpa aturan aktif, kartu tidak tampil.
12. **Jeda pembatalan berulang**: 3 pembatalan setelah pesanan diterima dalam 24 jam menjeda menerima pesanan 30 menit.

Berpasangan dengan backend yang memuat dua migrasi baru (`ride_passenger_ratings`, `driver_incentives`). Tanpa backend itu,
fitur Fase 2 diam (kartu tidak tampil, penilaian penumpang gagal dengan pesan, tiket tetap berfungsi).

Tidak ikut (alasan di `DRIVER_APP_FASE2.md`): telepon anonim, peta area ramai, antrean offline, penarikan di dalam aplikasi.

## Belum terbukti
- Batas "gerak tampil di penumpang <= 3 dtk" terukur 218-808 ms di server lokal; waktu radio seluler dan GPS HP BELUM diuji.
  Uji lapangan dua HP (`DRIVER_APP_FIELD_TEST.md`) berlaku.
- Foreground service dengan GPS 1 dtk: konsumsi baterai selama menuju titik jemput belum diukur di HP.
- Pernyataan: tinjauan penasihat hukum belum dilakukan.
