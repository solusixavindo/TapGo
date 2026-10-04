# Trust anchor TLS driver_app dan user_app

Berlaku mulai driver_app 1.0.0+8 dan user_app 2.0.5+34.

## Desain

Aplikasi hanya mempercayai rantai sertifikat yang berujung di salah satu **trust anchor yang
dibundel** (`SecurityContext(withTrustedRoots: false)` + `setTrustedCertificatesBytes`). Seluruh
validasi — rantai, masa berlaku, dan **hostname** — dikerjakan BoringSSL secara baku; callback
sertifikat buruk selalu menolak. Tidak ada nilai dari environment atau `--dart-define`, dan kunci
leaf server tidak berperan: perpanjangan sertifikat (termasuk dengan kunci baru) tidak memutus
aplikasi.

Kode: `apps/driver_app/lib/core/security/tls_pinning.dart` dan
`apps/user_app/lib/services/tls_pinning.dart` (isi identik).

## Mengapa bukan pin SPKI leaf

Pinning SPKI leaf lewat `badCertificateCallback` **tidak bekerja** terhadap rantai produksi. Server
menyajikan empat sertifikat (leaf, Let's Encrypt YE1, Root YE, ISRG Root X2). Dengan konteks tanpa
root, callback dipanggil **sekali dengan ISRG Root X2** — sertifikat teratas pada titik gagal
verifikasi — bukan leaf. Pin leaf, walau benar dan segar, tidak pernah cocok, dan semua permintaan
ditolak. Ini terjadi pada driver_app 1.0.0+4 sampai +7 dan user_app 2.0.5+33 (4 Okt 2026). Uji lama
memakai satu sertifikat self-signed (leaf adalah satu-satunya sertifikat) sehingga cacat itu tidak
terlihat, dan gerbang hanya membandingkan pin dengan SPKI live secara statis.

## Anchor yang dibundel

| Anchor | SHA-256 | Berakhir | Sumber |
|---|---|---|---|
| ISRG Root X1 | `96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6` | 2035-06-04 | toko sertifikat sistem macOS |
| ISRG Root X2 | `69:72:9B:8E:15:A8:6E:FC:17:7A:57:AF:B7:17:1D:FC:64:AD:D2:8C:2F:CA:8C:F1:50:7E:34:45:3C:CB:14:70` | 2040-09-17 | toko sertifikat sistem macOS; sama dengan letsencrypt.org |
| Root YE (tanda tangan silang oleh X2) | `0F:C0:90:1C:CA:2B:AE:9E:9F:DB:B0:2D:50:D0:2F:10:94:F7:B3:66:72:08:69:91:B9:E8:97:62:6D:C4:85:F0` | 2032-09-02 | disajikan server; diautentikasi dengan `openssl verify` terhadap Root X2 dari macOS |

Anchor adalah **root**, bukan intermediate, supaya penggantian intermediate Let's Encrypt (YE1 ke
YE2, dan seterusnya) tidak memutus aplikasi. `tls_pinning_test.dart` mengunci isi anchor lewat sidik
jari di atas.

Memverifikasi ulang (hanya data publik):

```bash
security find-certificate -a -c "ISRG Root X2" -p /System/Library/Keychains/SystemRootCertificates.keychain \
  | openssl x509 -noout -fingerprint -sha256
openssl verify -CAfile <root-x2.pem> <root-ye-silang.pem>
```

## Batas keamanan

- Lebih longgar dari pin leaf: sertifikat apa pun dari hierarki Let's Encrypt yang sah untuk
  `api.tapgolion.id` diterima. Pelindung dari CA publik lain atau CA yang disusupi, dan dari
  penyadapan oleh jaringan yang menyuntikkan CA sendiri. Pemeriksaan hostname diuji
  (`api_error_mapping_test.dart`, `tls_diagnosis_test.dart`).
- Root YR (jalur RSA generasi Y) **tidak** dibundel. Bila server beralih ke kunci RSA yang
  diterbitkan lewat jalur itu, aplikasi gagal terhubung sampai anchor ditambah.

## Pembaruan anchor

Perbarui **sebelum** salah satu terjadi: anchor kedaluwarsa (tabel di atas; yang terdekat Root YE,
2032-09-02), atau Let's Encrypt memindahkan rantai ke root yang tidak ada di sini. Urutannya: tambah
anchor baru dan rilis aplikasi lebih dulu, baru server berpindah; jangan menunggu sampai server
berganti, karena aplikasi lama tidak dapat dipulihkan tanpa pembaruan dari Play. Ikuti pengumuman
Let's Encrypt tentang perubahan root dan intermediate.

## Gerbang rilis

- `scripts/check-tls-anchors-live.sh <driver_app|user_app>` menjalankan handshake **sungguhan** ke
  `api.tapgolion.id` memakai kode aplikasi sendiri (anchor yang dibundel) dan kontrol negatif (tanpa
  anchor harus ditolak). Dipanggil gerbang rilis langkah 3b; build dibatalkan bila gagal.
- Gerbang langkah 5 memastikan anchor tertanam di `libapp.so` setiap ABI.
- Tes: handshake sungguhan dengan CA sintetis (anchor benar diterima, CA lain ditolak, hostname
  salah ditolak, anchor kosong fail-closed) di `api_error_mapping_test.dart` (driver) dan
  `tls_diagnosis_test.dart` (user).

## Tidak lagi dibutuhkan

`TAPGO_TLS_PIN_SHA256`, `--dart-define` untuk pin, `scripts/check-tls-pin-live.sh` (dihapus), dan
ketergantungan pada `reuse_key` di certbot untuk menjaga pin. Konfigurasi certbot di VPS tidak
memengaruhi aplikasi selama sertifikat tetap diterbitkan Let's Encrypt.

## Belum diverifikasi

Perilaku di perangkat Android nyata (mode rilis). Mesin TLS Dart sama, tetapi harus dibuktikan di HP
(lihat daftar uji HP).
