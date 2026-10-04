# TapGo user_app 2.0.5+34 — trust-anchor pinning

Tanggal: 2026-10-04. Dasar: 2.0.5+32 (versi di Play).

**2.0.5+33 tidak dapat terhubung ke server produksi dan tidak boleh dipasang atau diunggah.**

## Mengapa build ini ada

Pinning SPKI leaf lewat `badCertificateCallback` tidak bekerja terhadap rantai produksi: dengan
konteks tanpa root, callback menerima sertifikat **teratas** rantai yang gagal diverifikasi (ISRG
Root X2), bukan leaf, sehingga pin leaf yang benar pun tidak pernah cocok dan SETIAP permintaan
ditolak. Uji lama memakai satu sertifikat self-signed (leaf adalah satu-satunya sertifikat) dan
gerbang hanya membandingkan pin dengan SPKI live secara statis, jadi cacat itu lolos. Detail dan
bukti: `TLS_TRUST_ANCHORS.md`.

Menurut riwayat repo, 2.0.5+32 dibangun 25 Sep 2026, sebelum kode pinning masuk (1 Okt 2026), jadi
versi di Play tidak terpengaruh. Build ini adalah build user_app pertama yang membawa pinning TLS yang
benar. `versionCode` 34 supaya pemasang berkas menerima pembaruan dari 32 dan 33.

## Isi perubahan

Selain trust-anchor pinning dan `versionCode`, satu-satunya perubahan perilaku adalah diagnosis galat
TLS (pesan): kegagalan sertifikat tidak lagi tampil sebagai "Server TapGo belum dapat dihubungi".

- Sertifikat tidak dipercaya: "Perbarui aplikasi dari Google Play…".
- Sertifikat di luar masa berlaku atau kegagalan handshake lain: periksa tanggal dan jam HP; belum
  tentu berarti aplikasi harus diperbarui.
- Gangguan sinyal biasa tetap memakai pesan lama. Kegagalan TLS dilaporkan sekali per proses ke Sentry
  (kode dan host saja).
- Pemeta pesan PPOB diekstrak menjadi fungsi tersendiri dan pemeta pesan transfer dijadikan publik
  agar dapat diuji; perilakunya tidak berubah. Dependensi `crypto` yang tidak terpakai dihapus.

Fitur lain tidak diubah.

## Yang belum dilakukan

Belum ada uji HP untuk build ini; perilaku di perangkat Android nyata belum dibuktikan. Unggah hanya
ke track uji internal terlebih dulu (lihat daftar uji HP).
