# Flutter Startup Splash Hang Audit - TapGo user_app

Tanggal: 2026-06-18

## Scope Audit

Audit difokuskan pada aplikasi Flutter `apps/user_app` yang berhenti di splash/logo TapGo dan tidak masuk ke halaman login/dashboard.

Area yang diaudit:

1. `main.dart`
2. Firebase initialization
3. FlutterSecureStorage initialization
4. Device Fingerprint implementation terbaru
5. Dio interceptor `_TapGoApiClient`
6. Auth bootstrap flow
7. Splash screen navigation
8. Future yang dapat menyebabkan hang tanpa timeout
9. Exception yang dapat terjadi sebelum login screen tampil

Tidak dilakukan:

- deploy
- build release
- migration
- perubahan business flow
- production DB change

## Startup Flow Saat Ini

```text
main()
  WidgetsFlutterBinding.ensureInitialized()
  if production:
    await _prepareProductionFinalSync()
    _apiClient.setBaseUrl(production)
  else:
    await _serverConfigStore.loadApiBaseUrl()
  runApp()
    MaterialApp
      _SessionBootstrap
        _restore()
        if loaded:
          SplashGate
            delay 2.4 detik
            AuthScreen
```

## Temuan Utama

### 1. P0/P1 Candidate - `_prepareProductionFinalSync()` berjalan sebelum `runApp()`

File:

- `apps/user_app/lib/main.dart`

Kode terkait:

```dart
if (_isTapGoProductionBuild) {
  await _prepareProductionFinalSync();
  _apiClient.setBaseUrl(_productionApiRootUrl);
}
```

`_prepareProductionFinalSync()` melakukan:

```dart
final preferences = await SharedPreferences.getInstance();
await _serverConfigStore.resetApiBaseUrl();
await _persistentStore.clearProductionRuntimeCache();
await preferences.setBool(_productionFinalSyncResetKey, true);
```

Risiko:

- Jika `SharedPreferences.getInstance()` hang/error, `runApp()` tidak pernah dipanggil.
- Jika `FlutterSecureStorage.deleteAll()` di `clearProductionRuntimeCache()` hang/error platform, `runApp()` tidak pernah dipanggil.
- User hanya melihat native splash/logo TapGo.
- Tidak ada `try/catch` di `main()` untuk fallback ke `runApp()`.
- Tidak ada timeout.

Kemungkinan dampak real device:

- Setelah update app dari versi lama.
- Encrypted shared preferences corrupt.
- Android keystore error.
- Device tertentu lambat membuka secure storage.
- Storage terkunci/bermasalah setelah restore backup.

Kesimpulan:

Ini kandidat root cause paling kuat jika layar berhenti di logo sebelum login screen muncul.

### 2. P1 Candidate - `_SessionBootstrap._restore()` tidak punya top-level try/finally

File:

- `apps/user_app/lib/services/persistent_demo_store.dart`

`_restore()` memiliki timeout untuk:

- `restoreAuth()`
- `restoreSession()`
- `restoreTokens()`

Namun setelah itu ada beberapa await lain:

- `_persistentStore.clearSession()`
- `_apiClient.me()`
- `_apiClient.productionSnapshot()`
- `_persistentStore.saveSession()`
- `_persistentStore.restoreMembershipSnapshot()`

Risiko:

- Jika exception terjadi di luar blok `try` tertentu, `_loaded` tidak diset `true`.
- UI `_SessionBootstrap` akan tetap loading spinner.
- Jika error terjadi setelah `SplashGate` mulai, user bisa merasa splash tidak bergerak.

Catatan:

- `auth/me` dan `productionSnapshot()` memakai Dio timeout, jadi biasanya tidak infinite.
- Tetapi Dio interceptor sekarang menunggu `_deviceContextStore.load()` sebelum setiap request.
- `_deviceContextStore.load()` belum punya timeout/try-catch.

### 3. P1 Candidate - Device Fingerprint secure storage belum fault-tolerant

File:

- `apps/user_app/lib/services/tapgo_api_client.dart`

Interceptor:

```dart
onRequest: (options, handler) async {
  final context = await _deviceContextStore.load();
  options.headers.addAll(context.headers);
  handler.next(options);
}
```

`_TapGoDeviceContextStore.load()` melakukan secure storage read/write:

```dart
final deviceId = await _readOrCreate(_deviceIdKey, _newDeviceId);
final fingerprint = await _readOrCreate(...);
```

Risiko:

- Jika secure storage read/write hang/throw, request tidak dilanjutkan.
- `handler.next(options)` tidak dipanggil jika exception muncul.
- Login/register/auth restore dapat berhenti atau gagal sebelum response.
- Tidak ada fallback in-memory.
- Tidak ada timeout.

Catatan:

- Ini tidak langsung berjalan sebelum `runApp()`.
- Namun dapat memblokir `auth/me restore request` jika ada token lama.
- Dapat membuat aplikasi terlihat stuck saat bootstrap mencoba restore session.

### 4. Firebase Initialization

Temuan:

- `firebase_messaging` ada di `pubspec.yaml`.
- GeneratedPluginRegistrant memuat `firebase_core` dan `firebase_messaging`.
- Tidak ditemukan pemanggilan `Firebase.initializeApp()` di `lib`.

Kesimpulan:

- Firebase initialization bukan penyebab langsung hang di `main()` karena memang belum dipanggil.
- Jika fitur messaging dipakai nanti tanpa init, bisa error di runtime, tetapi tidak terlihat sebagai penyebab splash hang saat ini.

### 5. SplashGate Logic

File:

- `apps/user_app/lib/screens/splash_screen.dart`

Logic:

```dart
Future<void>.delayed(const Duration(milliseconds: 2400), () {
  if (mounted) {
    setState(() => _showAuth = true);
  }
});
```

Kesimpulan:

- SplashGate sendiri sederhana dan kecil kemungkinan hang.
- Jika SplashGate sudah tampil, seharusnya dalam 2,4 detik masuk `AuthScreen`.
- Jika tetap di logo, kemungkinan:
  - app sebenarnya masih di native splash sebelum Flutter render, atau
  - `AuthScreen` build melempar exception setelah `_showAuth = true`, sehingga UI tidak lanjut dengan benar, atau
  - main isolate tersumbat oleh operation async/platform yang tidak selesai.

### 6. Server config non-production

`_serverConfigStore.loadApiBaseUrl()` memakai `SharedPreferences.getInstance()` tanpa timeout dan berjalan sebelum `runApp()` pada staging/development.

Risiko lebih kecil dari production, tetapi pola sama:

- jika SharedPreferences bermasalah, `runApp()` tertunda.

## Root Cause Paling Mungkin

**Root cause paling mungkin: async storage cleanup/bootstrap berjalan sebelum `runApp()` tanpa timeout dan tanpa fail-open fallback.**

Terutama:

```dart
await _prepareProductionFinalSync();
```

yang kemudian memanggil:

```dart
await _persistentStore.clearProductionRuntimeCache();
```

dan `clearProductionRuntimeCache()` memanggil:

```dart
await _storage.deleteAll();
```

Jika secure storage bermasalah pada HP real, Flutter tidak pernah memanggil `runApp()`, sehingga user hanya melihat logo/splash.

## Patch Minimal-Risk yang Direkomendasikan

### Patch 1 - `main()` harus fail-open ke `runApp()`

Prinsip:

- Jangan biarkan cleanup/cache reset memblokir app launch.
- Semua init sebelum `runApp()` harus dibungkus timeout dan catch.
- Jika gagal, tetap lanjut ke login screen.

Rekomendasi:

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    if (_isTapGoProductionBuild) {
      await _prepareProductionFinalSync()
          .timeout(const Duration(seconds: 3));
      _apiClient.setBaseUrl(_productionApiRootUrl);
    } else {
      final savedApiBaseUrl = await _serverConfigStore
          .loadApiBaseUrl()
          .timeout(const Duration(seconds: 2), onTimeout: () => null);
      if (savedApiBaseUrl != null && savedApiBaseUrl.trim().isNotEmpty) {
        _apiClient.setBaseUrl(savedApiBaseUrl);
      }
    }
  } catch (error) {
    debugPrint('[TapGo Startup] startup init skipped: $error');
    if (_isTapGoProductionBuild) {
      _apiClient.setBaseUrl(_productionApiRootUrl);
    }
  }
  runApp(const ProviderScope(child: TapGoUserApp()));
}
```

### Patch 2 - `_prepareProductionFinalSync()` jangan gagal total jika storage bermasalah

Rekomendasi:

- Bungkus setiap step dengan try/catch.
- Tandai reset key hanya jika minimal SharedPreferences bisa ditulis.
- Jika secure storage deleteAll gagal, lakukan `clearSession()` saja.
- Jangan throw ke `main()`.

### Patch 3 - `_SessionBootstrap._restore()` harus punya try/finally

Prinsip:

- Apa pun error restore, UI harus masuk login.
- `_loaded` harus diset `true` di `finally` jika mounted.

Rekomendasi:

```dart
Future<void> _restore() async {
  try {
    // existing restore logic
  } catch (error) {
    debugPrint('[TapGo Startup] session restore failed: $error');
    await _persistentStore.clearSession();
    _apiClient.setAccessToken(null);
    if (mounted) {
      ref.read(_isAuthenticatedProvider.notifier).state = false;
    }
  } finally {
    if (mounted) {
      setState(() => _loaded = true);
    }
  }
}
```

### Patch 4 - Device fingerprint interceptor harus fail-open

Prinsip:

- Anti-abuse metadata penting, tetapi tidak boleh membuat app gagal login.
- Jika secure storage error, request tetap lanjut tanpa header atau dengan fallback temporary ID.

Rekomendasi:

```dart
onRequest: (options, handler) async {
  try {
    final context = await _deviceContextStore
        .load()
        .timeout(const Duration(seconds: 1));
    options.headers.addAll(context.headers);
  } catch (error) {
    debugPrint('[TapGo Device] fingerprint unavailable: $error');
    options.headers['X-TapGo-Platform'] = Platform.operatingSystem;
    options.headers['X-TapGo-App-Version'] = _TapGoDeviceContextStore.appVersion;
  }
  handler.next(options);
}
```

### Patch 5 - `_TapGoDeviceContextStore._readOrCreate()` harus catch storage error

Jika secure storage gagal:

- pakai in-memory fallback selama app session
- jangan throw

## Risiko Patch

| Patch | Risiko | Dampak |
| --- | --- | --- |
| Fail-open main | Rendah | App tetap masuk login meski cache cleanup gagal. |
| Try/finally SessionBootstrap | Rendah | Session lama invalid akan dibuang dan user login ulang. |
| Fail-open device fingerprint | Rendah | Anti-abuse metadata bisa kosong pada device bermasalah, tapi app tetap usable. |
| Timeout storage | Rendah | Device lambat mungkin tidak menyimpan fingerprint pada launch pertama. |

## Rekomendasi Prioritas

P1 segera:

1. Patch `main()` fail-open.
2. Patch `_SessionBootstrap._restore()` try/finally.
3. Patch Dio device fingerprint interceptor fail-open.

P2:

1. Tambahkan startup diagnostic log non-sensitive.
2. Tambahkan widget test untuk bootstrap failure masuk AuthScreen.
3. Tambahkan manual QA di HP real dark/light mode setelah clear data.

## Checklist Validasi Setelah Patch

1. Install app fresh.
2. Clear app data.
3. Launch app.
4. Pastikan splash maksimal 2-5 detik lalu masuk login.
5. Login user valid.
6. Logout.
7. Relaunch.
8. Simulasikan token expired: harus kembali login, bukan stuck.
9. Matikan internet: harus tetap masuk login atau dashboard error state, bukan stuck splash.
10. Cek log tidak menampilkan token/password.

## Kesimpulan

Bug paling mungkin bukan di SplashGate, tetapi pada async startup/bootstrap yang dapat menahan `runApp()` atau `_SessionBootstrap` tanpa fail-open.

Rekomendasi patch minimal-risk:

- startup init tidak boleh blocking permanen
- session restore harus selalu selesai ke login/dashboard
- device fingerprint tidak boleh memblokir request

Status:

```text
Root cause likely found.
Patch recommended.
No deploy/build/release/migration performed.
```
