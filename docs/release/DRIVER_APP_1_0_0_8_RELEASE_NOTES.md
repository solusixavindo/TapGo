# TapGo Driver 1.0.0+8 — Release Notes

Rilis ini menggantikan 1.0.0+7. **Driver 1.0.0+4, +5, +6, dan +7 tidak dapat terhubung ke server
produksi dan tidak boleh dipasang.** Isi fitur +5 sampai +7 (klasifikasi TLS, popup order, antrian
tanpa sisa) tetap berlaku.

## Mengapa +8 ada

Pinning SPKI leaf lewat `badCertificateCallback` tidak bekerja terhadap rantai produksi: dengan
konteks tanpa root, callback menerima sertifikat **teratas** rantai yang gagal diverifikasi (ISRG
Root X2), bukan leaf, sehingga pin leaf yang benar pun tidak pernah cocok dan SETIAP permintaan
ditolak. Uji lama memakai satu sertifikat self-signed (leaf adalah satu-satunya sertifikat) dan
gerbang hanya membandingkan pin dengan SPKI live secara statis, jadi cacat itu lolos. Detail dan
bukti: `TLS_TRUST_ANCHORS.md`.

`versionCode` naik menjadi 8 supaya pemasang berkas menerima pembaruan dari +7.

## Isi perubahan

- **Trust-anchor pinning** menggantikan pin SPKI leaf: ISRG Root X1, ISRG Root X2, dan Root YE
  dibundel sebagai satu-satunya trust anchor. Validasi rantai, masa berlaku, dan hostname dikerjakan
  BoringSSL; callback sertifikat buruk selalu menolak. Tidak ada lagi `TAPGO_TLS_PIN_SHA256`.
- Diagnosis galat: `TLS_PIN_MISMATCH` ("Perbarui aplikasi dari Google Play…") hanya untuk sertifikat
  yang tidak dipercaya (rantai tidak berujung di anchor, atau hostname tidak cocok);
  `TLS_CERTIFICATE_INVALID` ("Periksa tanggal dan jam HP Anda… belum tentu berarti aplikasi harus
  diperbarui") untuk sertifikat di luar masa berlaku dan kegagalan handshake lain.
- Dependensi `crypto` yang tidak terpakai dihapus.

## Pembuktian

- Tes handshake sungguhan dengan CA sintetis: anchor benar diterima, CA lain ditolak, hostname salah
  ditolak, anchor kosong fail-closed, banyak anchor, dan klasifikasi penolakan; uji mutasi (callback
  menerima semua) membuat tes gagal.
- Gerbang rilis menjalankan handshake sungguhan ke `api.tapgolion.id` memakai kode aplikasi
  (`scripts/check-tls-anchors-live.sh`) dan memeriksa anchor tertanam di `libapp.so`.

## Yang belum dilakukan

Belum ada uji HP untuk 1.0.0+8; perilaku di perangkat Android nyata belum dibuktikan. Tiga endpoint
SOS / `safety-status` / `face-check/recheck-attempt` belum ada di backend produksi. Dokumen ini tidak
menyatakan driver_app siap 100%.
