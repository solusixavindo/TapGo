# TapGo user_app 2.0.5+33 — pin TLS sesuai sertifikat 4 Okt 2026

> **PERINGATAN (4 Okt 2026): artefak ini tidak dapat terhubung ke server produksi** (cacat pinning TLS; lihat `TLS_TRUST_ANCHORS.md`). Jangan dipasang atau diunggah. Pengganti: user_app 2.0.5+34.

Tanggal: 2026-10-04. Dasar: 2.0.5+32.

## Mengapa build ini ada

- Pin TLS di aplikasi adalah hash SPKI sertifikat leaf `api.tapgolion.id`. Sertifikat diterbitkan ulang
  pada 4 Okt 2026 20:08 WIB (berlaku sampai 2 Jan 2027). Pin leaf yang lama tidak cocok dengan
  sertifikat itu; itulah penyebab driver_app 1.0.0+4 dan 1.0.0+5 tidak dapat login.
- Menurut riwayat repo, 2.0.5+32 dibangun pada 25 Sep 2026, sebelum kode pinning masuk (1 Okt 2026).
  Build ini adalah build user_app pertama yang membawa pinning TLS, dan pinnya cocok dengan sertifikat
  4 Okt 2026 20:08 WIB. `versionCode` naik menjadi 33 supaya pemasang berkas menerima pembaruan dari 32.
- Hash di dalam APK adalah sidik kunci publik, bukan rahasia.

## Isi perubahan

Selain pin dan `versionCode`, satu-satunya perubahan perilaku adalah diagnosis galat TLS: kegagalan
sertifikat tidak lagi tampil sebagai "Server TapGo belum dapat dihubungi".

- Penolakan pin: "Perbarui aplikasi dari Google Play…".
- Kegagalan TLS lain (mis. jam HP salah): periksa tanggal dan jam HP; belum tentu berarti aplikasi
  harus diperbarui.
- Gangguan sinyal biasa tetap memakai pesan lama. Kegagalan TLS dilaporkan sekali per proses ke Sentry
  (kode dan host saja).
- Pemeta pesan PPOB diekstrak menjadi fungsi tersendiri dan pemeta pesan transfer dijadikan publik
  agar dapat diuji; perilakunya tidak berubah. Tes Account hub dibuat tidak bergantung urutan tes lain.

Fitur lain tidak diubah.

## Syarat

Apakah pin tetap cocok pada perpanjangan sertifikat berikutnya bergantung pada konfigurasi certbot di
VPS — langkah Owner di `DEPLOY_VPS.md` bagian 14.1. Rilis ini tidak mengubahnya dan tidak mengklaim
statusnya.

## Yang belum dilakukan

Belum ada uji HP untuk build ini.
