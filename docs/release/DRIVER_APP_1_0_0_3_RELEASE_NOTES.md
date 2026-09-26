# TapGo driver_app 1.0.0+3 (dalam pengerjaan)

Tanggal mulai: 2026-09-26. Rencana lengkap: `DRIVER_APP_READINESS_PLAN.md`.

## Tahap D1 (selesai): bisa dibangun dan diserahkan
- Build rilis kini berhasil. Tiga penyebab gagal diperbaiki: target JVM plugin `tflite_flutter`, `compileSdk` plugin
  (android-31 vs dependensi AndroidX >= 34), dan aturan R8 untuk delegasi GPU TFLite yang opsional.
- Kunci unggah khusus driver (terpisah dari kunci user_app), disimpan di `apps/driver_app/android/keystore/` (diabaikan git).
- `scripts/release-gate-driver-app.sh` dan job CI `driver_app_release_artifact` (build rilis + pemindai artefak).
