# Google Play Store Listing Draft — TapGo Driver

Draf untuk Play Console. Semua teks di bawah boleh disalin langsung; sesuaikan bila Owner ingin nada
yang berbeda.

## App Name

TapGo Driver

## Short Description

Aplikasi mitra pengemudi TapGo: terima order, navigasi, dan kelola penghasilan.

Character count: 62 / 80

## Full Description

TapGo Driver adalah aplikasi resmi mitra pengemudi TapGo dari PT. TapGo Lion Indonesia, untuk
menerima dan menjalankan pesanan Ojek Online (TapGo Ride) dan Mobil (TapGo Car).

Dengan TapGo Driver, mitra dapat:

- Menerima tawaran pesanan terdekat sesuai posisi dan jenis kendaraan.
- Melihat rute jemput dan tujuan, lalu membuka navigasi lewat Google Maps.
- Mengelola status Online/Offline dan melihat riwayat perjalanan.
- Memantau dompet TapGo, komisi, dan riwayat top up.
- Mengajukan dan melengkapi dokumen verifikasi mitra (KTP, SIM, STNK).
- Verifikasi wajah harian sebelum mulai menerima pesanan, untuk keamanan akun.
- Mengirim sinyal darurat (SOS) bila terjadi keadaan tidak aman selama bertugas.
- Menghubungi dukungan resmi TapGo melalui WhatsApp.

Selama berstatus Online, aplikasi membagikan lokasi perangkat secara berkala ke sistem TapGo — lewat
layanan latar depan dengan notifikasi tetap — supaya penumpang dan sistem pencocokan dapat melihat
posisi mitra. Lokasi berhenti dibagikan segera setelah status diubah menjadi Offline.

Komisi, insentif, dan benefit lain mengikuti ketentuan resmi TapGo, status akun, serta validasi
transaksi dan sistem anti-penyalahgunaan. TapGo tidak menjanjikan penghasilan tetap; seluruh
penghasilan mitra bergantung pada aktivitas, kelayakan, dan validasi sistem.

TapGo Driver ditujukan khusus untuk mitra yang sudah terverifikasi — bukan aplikasi untuk penumpang.
Penumpang yang ingin memesan Ojek Online silakan memakai aplikasi TapGo (Penumpang).

## Category Recommendation

Primary category recommendation:

- Maps & Navigation

Alternative category:

- Business

Reason: fungsi utama aplikasi adalah menerima pesanan, navigasi rute, dan berbagi lokasi real-time —
bukan transaksi finansial sebagai fitur utama (beda dari aplikasi TapGo Penumpang).

## Contact Email

support@tapgolion.id

## Website

https://tapgolion.id

## Privacy Policy URL

https://tapgolion.id/privacy-policy

(Halaman yang sama dengan aplikasi TapGo Penumpang — sudah memuat bagian khusus "Data yang
Dikumpulkan oleh Aplikasi TapGo Driver", lihat `apps/landing-page/src/app/privacy-policy/page.tsx`.)

## Terms URL

https://tapgolion.id/terms-and-conditions

## Notes for Google Play Reviewer

- TapGo Driver adalah aplikasi KHUSUS mitra pengemudi berstatus aktif dan terverifikasi — bukan
  aplikasi konsumen umum. Pendaftaran mitra baru memerlukan pengajuan dokumen yang ditinjau manual
  oleh tim TapGo sebelum akun bisa menerima pesanan.
- Akun uji untuk reviewer: lihat `docs/release/DRIVER_APP_REVIEWER_TEST_ACCOUNT.md` — kredensial
  disiapkan terpisah, TIDAK dicantumkan di listing publik.
- Aplikasi meminta izin lokasi (foreground saja, dengan layanan latar depan bernotifikasi tetap saat
  online) dan kamera (verifikasi wajah harian + pengambilan foto dokumen). Tidak meminta izin lokasi
  latar belakang (background location).
- Verifikasi wajah sepenuhnya on-device (tidak dikirim ke pihak ketiga untuk pemrosesan itu).
- Dokumen identitas (KTP/SIM/STNK) disimpan terenkripsi dan dihapus otomatis maksimal 72 jam setelah
  diunggah.
- Komisi dan penghasilan mengikuti validasi backend TapGo; aplikasi tidak menjanjikan hasil tetap.
- Delete account dan informasi kontak tersedia lewat aplikasi dan situs publik.

## Content Tone Checklist

Use:

- terima order
- navigasi rute
- kelola penghasilan
- komisi sesuai syarat
- verifikasi mitra

Avoid: klaim penghasilan pasti, jaminan hasil tetap, istilah yang bisa ditafsirkan sebagai skema
berjenjang atau penghasilan pasif dijamin.

## Belum tersedia (butuh tindakan Owner sebelum listing bisa disubmit)

- Screenshot dari HP asli (minimal 4, resolusi sesuai syarat Play Console) — lihat
  `docs/release/DRIVER_APP_READINESS_PLAN.md` fase E5.
- Video promo (opsional, tidak wajib).
