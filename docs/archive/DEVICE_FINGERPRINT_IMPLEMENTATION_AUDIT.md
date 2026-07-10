# TapGo Mobile Device Fingerprint Implementation Audit

Tanggal audit: 2026-06-17

## Ringkasan

Backend anti-abuse phase 2 sudah menerima metadata perangkat melalui:

- `X-TapGo-Device-Id`
- `X-TapGo-Device-Fingerprint`
- `X-TapGo-App-Version`
- `X-TapGo-Platform`
- body register opsional: `deviceId`, `deviceFingerprint`

Audit Flutter `apps/user_app` menunjukkan semua request utama user app keluar melalui satu client:

- `apps/user_app/lib/services/tapgo_api_client.dart`
- class `_TapGoApiClient`
- menggunakan `Dio`

Lokasi ini adalah titik paling aman untuk memasang device metadata karena login, register, wallet, referral, membership, withdraw, invoice, admin endpoint, dan endpoint lain memakai client yang sama.

## File dan Flow yang Diaudit

| Area | File | Temuan |
| --- | --- | --- |
| App bootstrap | `apps/user_app/lib/main.dart` | Membuat singleton `_apiClient` dan mengatur production base URL. |
| API client | `apps/user_app/lib/services/tapgo_api_client.dart` | Semua endpoint utama memakai `_TapGoApiClient`. |
| Register/login UI | `apps/user_app/lib/screens/auth_screen.dart` | Register/login memanggil `_apiClient.register()` dan `_apiClient.login()`. |
| Auth token | `apps/user_app/lib/services/tapgo_api_client.dart` | `Authorization` diset via `setAccessToken`. |
| Secure storage | `apps/user_app/lib/services/persistent_demo_store.dart` | App sudah memakai `FlutterSecureStorage` dengan encrypted shared preferences. |
| Tests | `apps/user_app/test/widget_test.dart` | Test UI tidak mengakses network langsung. |

## Lokasi Terbaik Pengiriman Header

Lokasi terbaik adalah `Dio` interceptor di `_TapGoApiClient`.

Alasan:

- Satu titik untuk semua request.
- Tidak perlu mengubah setiap endpoint satu per satu.
- Register/login otomatis membawa header.
- Endpoint setelah login juga otomatis membawa header bersama `Authorization`.
- Risiko perubahan UI sangat kecil.

## Implementasi yang Dipasang

Ditambahkan:

- `_TapGoDeviceContext`
- `_TapGoDeviceContextStore`
- `Dio` request interceptor
- body register tambahan: `deviceId`, `deviceFingerprint`

Header yang dikirim:

- `X-TapGo-Device-Id`
- `X-TapGo-Device-Fingerprint`
- `X-TapGo-App-Version`
- `X-TapGo-Platform`

## Privacy dan Security

Implementasi tidak menggunakan:

- IMEI
- Android ID mentah
- nomor seri perangkat
- nomor HP sebagai fingerprint
- data KTP
- data biometrik
- data lokasi

Device ID dibuat sebagai nilai acak per instalasi:

- dibuat dengan `Random.secure()`
- disimpan di `FlutterSecureStorage`
- stabil selama data aplikasi tidak dihapus
- berubah jika user uninstall/reinstall atau clear app data

Fingerprint adalah nilai synthetic app-scoped:

```text
tapgo:{platform}:{deviceId}
```

Backend dapat melakukan hash terhadap fingerprint tersebut sesuai desain anti-abuse.

## Risiko

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| User uninstall/reinstall | Device ID berubah | Tetap cukup untuk monitoring soft flag, bukan hard block. |
| Secure storage gagal pada device tertentu | Header mungkin gagal dibuat | FlutterSecureStorage sudah dependency existing; perlu validasi HP real. |
| App version masih konstanta manual | Bisa tertinggal jika pubspec version berubah | Rekomendasi P2: gunakan `package_info_plus` pada rilis berikutnya. |
| Fingerprint tidak hardware-bound | Lebih sulit mendeteksi reinstall farming | Sengaja dipilih untuk privasi dan Google Play compliance. |

## Kesimpulan

Status implementasi: **PARTIAL READY untuk Closed Testing / UAT**

Implementasi sudah cukup untuk monitoring anti-abuse low-risk tanpa mengambil identifier sensitif. Untuk public launch skala besar, disarankan menambahkan app version otomatis via package metadata dan dashboard admin untuk membaca flag anti-abuse.
