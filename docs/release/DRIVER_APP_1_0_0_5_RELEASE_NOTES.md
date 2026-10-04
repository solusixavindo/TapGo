# TapGo Driver 1.0.0+5 — Release Notes

> **PERINGATAN (4 Okt 2026): artefak ini tidak dapat terhubung ke server produksi** (cacat pinning TLS: callback menerima sertifikat teratas, bukan leaf; lihat `TLS_TRUST_ANCHORS.md`). Jangan dipasang atau diunggah. Pengganti: driver 1.0.0+8.

Rilis ini menggantikan 1.0.0+4. Artefak 1.0.0+4 yang gagal login pada uji HP 4 Oktober 2026
**tidak boleh dikirim ulang**; satu-satunya artefak perbaikan yang sah adalah 1.0.0+5.

## Mengapa versionCode naik menjadi 5

APK 1.0.0+4 sudah terpasang di HP uji dan gagal login. Pemasang berkas Android menolak
memperbarui aplikasi bila `versionCode` paket baru tidak lebih tinggi dari yang terpasang, jadi
perbaikan yang diberi kode 4 lagi tidak akan pernah menimpa APK yang rusak itu. Nama versi tetap
1.0.0; hanya nomor build yang naik.

## Isi perbaikan

Sama dengan audit 4 Oktober 2026 (`DRIVER_APP_AUDIT_4_OKT_2026.md`, commit asal 9e63d1d), ditambah
dua perubahan baru di bawah.

Dari audit 4 Oktober:
- Kegagalan TLS dibedakan dari gangguan sinyal dan dilaporkan sekali ke Sentry (kode dan host saja).
- Login ditolak (kata sandi salah) tetap di form login, bukan layar "Sesi berakhir".
- Pesan galat server berbahasa Inggris dipetakan ke Indonesia.
- Gangguan jaringan sesaat saat polling tidak lagi menutup workspace dan tidak menghentikan polling
  serta pengiriman lokasi.
- SOS tidak macet pada galat tak terduga; WhatsApp CS tetap tersedia.
- Wizard pengajuan tidak lagi tertutup oleh pesan galat yang berisi kata "terkirim".
- Tautan isi saldo dari server hanya dibuka bila https ke `tapgolion.id`.
- Izin `RECORD_AUDIO` dan `READ_MEDIA_IMAGES` dihapus; foto wajah sementara dihapus setelah
  verifikasi; warna teks mode gelap diperbaiki.

Baru di 1.0.0+5:
1. **Klasifikasi TLS dipertajam.** Sebelumnya setiap kegagalan TLS saat pinning aktif disebut
   "pin tidak cocok" dan pesannya menyuruh memperbarui dari Google Play. Sekarang hanya penolakan
   oleh pemeriksaan pin (`badCertificate`) yang memakai pesan itu (`TLS_PIN_MISMATCH`). Kegagalan
   TLS lain (`TlsException`) memakai `TLS_CERTIFICATE_INVALID` dengan pesan yang meminta memeriksa
   tanggal dan jam HP dan menyebut bahwa ini belum tentu berarti aplikasi harus diperbarui.
2. **Popup order masuk.** Order baru yang datang lewat push maupun polling 12 detik kini membuka
   `OfferDetailSheet` yang sudah ada tanpa perlu mengetuk daftar tawaran, kecuali ada perjalanan
   aktif, tawaran itu sudah ditutup atau ditolak pada sesi ini, atau sheet yang sama sedang terbuka.
   Bila beberapa tawaran baru datang bersamaan, yang terbaru dibuka. Notifikasi `ride_offer` yang
   judul dan isinya kosong diberi teks bawaan "Order baru" / "Ada penumpang di dekat Anda" supaya
   tidak diam-diam. Tidak ada izin `USE_FULL_SCREEN_INTENT` yang ditambahkan.

## Syarat agar APK ini tetap berfungsi (tindakan Owner, bukan kode)

1. **Rotasi kunci sertifikat.** Pin leaf tetap putus pada perpanjangan berikutnya (sekitar awal
   Desember 2026) kecuali certbot memakai `reuse_key = True`. Langkahnya ada di `DEPLOY_VPS.md`
   bagian 14.1 (pekerjaan VPS Owner; berkas itu tidak diubah oleh rilis ini).
2. **Backend produksi belum memuat tiga endpoint dari PR #1:** `POST /driver/sos`,
   `GET /driver/safety-status`, dan `POST /driver/face-check/recheck-attempt`. Di produksi saat ini
   ketiganya membalas `ROUTE_NOT_FOUND`: SOS gagal dengan pesan jelas dan jalur WhatsApp CS,
   banner kelelahan dan verifikasi ulang wajah tidak muncul.

## Yang belum dilakukan

Belum ada uji HP untuk 1.0.0+5. Verifikasi wajah tetap nonaktif di server
(`DRIVER_FACE_CHECK_ENABLED`) dan model wajah tidak dibundel; komisi (`DRIVER_COMMISSION_ENABLED`)
tidak disentuh. Dokumen ini tidak menyatakan driver_app siap 100%.
