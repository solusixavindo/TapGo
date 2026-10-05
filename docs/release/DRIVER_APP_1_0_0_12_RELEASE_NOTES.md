# TapGo Driver 1.0.0+12 — Release Notes

Tanggal: 2026-10-06. Menggantikan 1.0.0+11 (isi +11 tetap berlaku). `versionCode` 12. Pin tetap trust-anchor.

## Mengapa +12 ada

Pemeriksaan AAB +11 sebelum unggah ke Play menemukan dua pustaka native **x86_64** yang tidak selaras
16 KB (alignment 4 KB): `libtensorflowlite_jni.so` dan `libtensorflowlite_gpu_jni.so`. Play mensyaratkan
dukungan ukuran halaman 16 KB untuk aplikasi yang menarget Android 15+ (kita menarget 36), jadi AAB itu
berisiko ditolak. arm64-v8a dan armeabi-v7a tidak bermasalah.

## Perubahan

- **ABI x86_64 dikeluarkan dari build driver** (`ndk { abiFilters }` hanya `arm64-v8a` dan `armeabi-v7a`).
  x86_64 hanya dipakai emulator dan sebagian kecil Chromebook, bukan ponsel driver. Tidak ada perubahan
  kode aplikasi, tampilan, atau perilaku; pustaka TensorFlow Lite tidak diperbarui.
- **Gerbang rilis** (`scripts/release-gate-driver-app.sh` dan `release-gate-user-app.sh`) kini memanggil
  `scripts/check-native-alignment.sh`: setiap segmen LOAD pustaka 64-bit pada APK dan AAB harus beralignment
  ≥ 16 KB, dan untuk driver ABI x86_64 tidak boleh ada. Dibuktikan: skrip menolak AAB +11 dan meloloskan
  user_app +37.

Tes: `apps/driver_app/test/build_config_test.dart` (gagal bila x86_64 kembali ke `abiFilters`).

## Dampak

- Ukuran unduhan sedikit lebih kecil (tanpa satu set pustaka). Perangkat arm tidak terpengaruh.
- Perangkat x86_64 (emulator Android Studio berarsitektur x86_64) tidak lagi didukung untuk APK ini; gunakan
  emulator arm64 atau HP fisik.
- Isi +10 dan +11 (bunyi channel `tapgo_alerts_v2`, popup dan polling chat, pesan cepat, tanpa label
  Offline) tetap berlaku tanpa perubahan.

## Catatan uji HP (belum dilakukan)

- [ ] Pasang di HP arm64 yang biasa dipakai: aplikasi terbuka, login, beranda termuat.
- [ ] Verifikasi wajah (bila diaktifkan) tidak crash (memakai pustaka TensorFlow Lite arm).
- [ ] Ulangi daftar uji bunyi/chat di `DRIVER_APP_1_0_0_11_RELEASE_NOTES.md`.

## Yang belum dilakukan

Belum ada uji HP. Penerimaan Play atas AAB ini baru terbukti setelah diunggah.
