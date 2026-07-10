# TapGo Device Fingerprint Deploy Plan

Tanggal: 2026-06-17

## Status

Mobile patch siap untuk UAT lokal.

Tidak dilakukan:

- deploy backend
- build APK/AAB release
- migration
- production DB change

## File Mobile yang Diubah

- `apps/user_app/lib/main.dart`
- `apps/user_app/lib/services/tapgo_api_client.dart`

## Tahapan Deploy Aman

### 1. Validasi Lokal

Jalankan:

```bash
cd apps/user_app
flutter analyze
flutter test
```

Opsional debug build non-release:

```bash
cd apps/user_app
flutter build apk --debug --dart-define=TAPGO_APP_MODE=staging
```

Catatan: user meminta tidak build APK/AAB release pada tahap ini.

### 2. Validasi Backend Compatibility

Pastikan backend production/staging menerima header berikut tanpa error:

```text
X-TapGo-Device-Id
X-TapGo-Device-Fingerprint
X-TapGo-App-Version
X-TapGo-Platform
```

Endpoint yang wajib dicek di staging/UAT:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/wallet`
- `GET /api/v1/referrals/summary`

### 3. Validasi HP Real

Checklist:

- Register user baru berhasil.
- Login user lama berhasil.
- Wallet tetap tampil.
- Referral tetap tampil.
- Tidak ada crash secure storage.
- Backend registration event mencatat device fingerprint jika migration anti-abuse sudah tersedia di environment test.
- Setelah logout/login ulang, device ID tetap sama.
- Setelah clear app data, device ID berubah.

### 4. Google Play / Privacy

Update dokumen Google Play Data Safety sebelum public launch:

- Device/app metadata digunakan untuk keamanan akun, pencegahan fraud, dan anti-abuse.
- Tidak menggunakan IMEI atau identifier hardware sensitif.
- Data dikirim ke backend TapGo melalui HTTPS.

### 5. Production Rollout

Syarat sebelum masuk APK/AAB production:

- `flutter analyze` PASS.
- `flutter test` PASS.
- Backend anti-abuse migration sequence sudah aman.
- Midtrans/public launch blockers diputuskan owner.
- Privacy Policy dan Data Safety sudah sinkron.

## Rollback Plan

Jika terjadi error HP real:

1. Revert perubahan di `_TapGoApiClient` interceptor.
2. Revert body register `deviceId` dan `deviceFingerprint`.
3. Build ulang APK/AAB setelah approval owner.

Karena patch tidak mengubah schema mobile dan tidak membuat data lokal kritikal selain secure storage keys, rollback mobile aman.

## Risiko Tersisa

- Secure storage edge case di device tertentu perlu test HP real.
- App version manual harus dijaga sinkron dengan `pubspec.yaml`.
- Tanpa migration anti-abuse di backend production, header hanya dikirim tetapi belum menjadi monitoring penuh.
