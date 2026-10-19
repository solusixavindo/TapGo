# Tambalan TapGo pada geolocator_android 4.6.2

Dua perubahan.

1. Id saluran diganti dari `geolocator_channel_01` menjadi `tapgo_driver_online_01` (`GeolocatorLocationService.java`) supaya saluran lama berimportansi NONE yang mungkin sudah tersimpan di perangkat (dari build uji sebelumnya) tidak ikut terpakai; Android tidak mengizinkan aplikasi menaikkan importansi saluran yang sudah ada.
2. Satu perubahan lain, di `android/src/main/java/com/baseflow/geolocator/location/BackgroundNotification.java`:
saluran notifikasi layanan latar depan dibuat dengan `IMPORTANCE_LOW` (upstream: `IMPORTANCE_NONE`).

Alasan: `IMPORTANCE_NONE` memblokir notifikasi. Layanan lokasi tetap berjalan, tetapi driver tidak melihat notifikasi
"TapGo Driver aktif" di bayangan notifikasi, padahal aplikasi, kebijakan privasi, dan deklarasi Play menyatakan notifikasi
tetap terlihat selama Online.

Dipasang lewat `dependency_overrides` di `pubspec.yaml`. Saat memperbarui `geolocator`, periksa apakah upstream sudah
memperbaikinya; bila sudah, hapus folder ini dan override-nya. Lisensi asli (BSD-3) ada di `LICENSE`.
