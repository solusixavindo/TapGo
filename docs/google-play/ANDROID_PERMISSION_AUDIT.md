# Android Permission Audit - TapGo User App

Tanggal audit: 15 Juli 2026  
Scope: `apps/user_app`

## Ringkasan

Package final: `id.tapgolion.tapgo`  
Manifest utama: `apps/user_app/android/app/src/main/AndroidManifest.xml`

TapGo User App menggunakan permission minimum untuk koneksi backend dan upload dokumen/profil. Tidak ditemukan permission SMS, kontak, lokasi, background location, phone state, exact alarm, atau foreground service pada manifest utama.

## Permission Aktif

| Permission | Status | Tujuan | Catatan Google Play |
|---|---:|---|---|
| `android.permission.INTERNET` | Wajib | Koneksi REST API TapGo, checkout payment, legal page, dan data dashboard | Deklarasikan sebagai network access normal. |
| `android.permission.ACCESS_NETWORK_STATE` | Wajib | Membaca status konektivitas agar UI bisa menangani error jaringan | Tidak sensitif. |
| `android.permission.CAMERA` | Opsional tetapi dipakai | Ambil foto KTP/selfie/dokumen membership ketika user memakai fitur upload | Wajib dijelaskan di Data Safety sebagai foto/dokumen pengguna. Minta hanya saat fitur upload dipakai. |
| `android.permission.READ_MEDIA_IMAGES` | Opsional tetapi dipakai | Pilih gambar dari galeri pada Android 13+ untuk KTP/selfie/profil | Wajib dijelaskan di Data Safety sebagai akses foto/gambar. |
| `android.permission.READ_EXTERNAL_STORAGE` `maxSdkVersion=32` | Legacy untuk perangkat lama | Pilih gambar dari galeri pada Android 12 ke bawah | Tetap perlu disclosure karena dipakai pada OS lama. |

## Permission Tidak Ditemukan

| Permission | Status |
|---|---|
| `WRITE_EXTERNAL_STORAGE` | Tidak dipakai |
| `ACCESS_FINE_LOCATION` | Tidak dipakai |
| `ACCESS_COARSE_LOCATION` | Tidak dipakai |
| `POST_NOTIFICATIONS` | Tidak dipakai di manifest utama |
| `READ_PHONE_STATE` | Tidak dipakai |
| SMS permissions | Tidak dipakai |
| Contacts permissions | Tidak dipakai |
| Background location | Tidak dipakai |
| Foreground service | Tidak dipakai |
| Exact alarm | Tidak dipakai |

## Runtime Permission

- Kamera/media hanya boleh diminta saat user membuka fitur upload dokumen/profil.
- Penolakan permission tidak boleh membuat aplikasi crash.
- Jika upload KTP/selfie diwajibkan untuk membership tertentu, tampilkan instruksi yang jelas dan jalur retry.

## Rekomendasi

1. Pertahankan permission saat ini jika fitur KTP/selfie masih aktif.
2. Jangan menambah permission lokasi/SMS/kontak tanpa kebutuhan produk yang jelas.
3. Jika push notification diaktifkan pada Android 13+, tambahkan `POST_NOTIFICATIONS` dan update Data Safety/App Content.

