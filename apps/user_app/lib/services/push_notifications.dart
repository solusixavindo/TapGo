part of '../main.dart';

/// Pesan push yang sudah dinormalisasi dari plugin, supaya logika di bawah
/// tidak bergantung pada tipe Firebase (dan dapat diuji tanpa Firebase).
class TapGoPushMessage {
  const TapGoPushMessage({
    required this.title,
    required this.body,
    this.data = const {},
  });

  final String title;
  final String body;
  final Map<String, String> data;
}

/// Batas antara aplikasi dan plugin Firebase. Implementasi nyata di bawah;
/// uji memakai implementasi palsu lewat [tapGoPushPlatformForTests].
abstract class TapGoPushPlatform {
  /// Meminta izin notifikasi lalu mengembalikan token FCM; null bila izin
  /// ditolak atau Firebase tidak tersedia.
  Future<String?> obtainToken();
  Stream<String> get tokenRefreshes;
  Stream<TapGoPushMessage> get foregroundMessages;

  /// Notifikasi diketuk saat aplikasi di latar belakang.
  Stream<TapGoPushMessage> get openedMessages;

  /// Notifikasi yang diketuk hingga membuka aplikasi dari keadaan tertutup.
  Future<TapGoPushMessage?> initialMessage();
  Future<void> deleteToken();
}

class FirebasePushPlatform implements TapGoPushPlatform {
  Future<bool> _ensureInitialized() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      return true;
    } catch (error) {
      _tapGoDebugLog('[TapGo Push] Firebase tidak tersedia: $error');
      return false;
    }
  }

  static TapGoPushMessage _convert(RemoteMessage message) {
    return TapGoPushMessage(
      title: message.notification?.title ?? '',
      body: message.notification?.body ?? '',
      data: {
        for (final entry in message.data.entries)
          if (entry.value is String) entry.key: entry.value as String,
      },
    );
  }

  @override
  Future<String?> obtainToken() async {
    if (!await _ensureInitialized()) {
      return null;
    }
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      return null;
    }
    return messaging.getToken();
  }

  @override
  Stream<String> get tokenRefreshes async* {
    if (await _ensureInitialized()) {
      yield* FirebaseMessaging.instance.onTokenRefresh;
    }
  }

  @override
  Stream<TapGoPushMessage> get foregroundMessages =>
      FirebaseMessaging.onMessage.map(_convert);

  @override
  Stream<TapGoPushMessage> get openedMessages =>
      FirebaseMessaging.onMessageOpenedApp.map(_convert);

  @override
  Future<TapGoPushMessage?> initialMessage() async {
    if (!await _ensureInitialized()) {
      return null;
    }
    final message = await FirebaseMessaging.instance.getInitialMessage();
    return message == null ? null : _convert(message);
  }

  @override
  Future<void> deleteToken() async {
    if (await _ensureInitialized()) {
      await FirebaseMessaging.instance.deleteToken();
    }
  }
}

final _rideReferencePattern = RegExp(r'^RID-[A-Z0-9]{6,20}$');

/// Referensi perjalanan dari data push, atau null bila tidak ada / bentuknya
/// tidak sah. Data push tidak dipercaya mentah: hanya bentuk yang dikenal yang
/// boleh menentukan layar yang dibuka.
String? tapGoRideReferenceFromPush(Map<String, String> data) {
  final reference = data['rideReference'];
  if (reference != null && _rideReferencePattern.hasMatch(reference)) {
    return reference;
  }
  return null;
}

/// Mengelola siklus token push untuk satu sesi masuk. Semua langkahnya
/// best-effort: kegagalan push tidak boleh mengganggu login atau logout.
class TapGoPushController {
  TapGoPushController({
    required this.platform,
    required this.register,
    required this.unregister,
    required this.onForeground,
    required this.onOpened,
  });

  final TapGoPushPlatform platform;
  final Future<void> Function(String token) register;
  final Future<void> Function(String token) unregister;
  final void Function(TapGoPushMessage message) onForeground;
  final void Function(TapGoPushMessage message) onOpened;

  final List<StreamSubscription<Object?>> _subscriptions = [];
  String? _token;
  bool _started = false;

  bool get started => _started;

  Future<void> start() async {
    if (_started) {
      return;
    }
    _started = true;
    try {
      final token = await platform.obtainToken();
      if (!_started) {
        return;
      }
      if (token != null && token.isNotEmpty) {
        await _register(token);
      }
      _subscriptions
        ..add(platform.tokenRefreshes.listen(
          (token) => unawaited(_register(token)),
          onError: (_) {},
        ))
        ..add(platform.foregroundMessages.listen(onForeground, onError: (_) {}))
        ..add(platform.openedMessages.listen(onOpened, onError: (_) {}));
      final initial = await platform.initialMessage();
      if (initial != null && _started) {
        onOpened(initial);
      }
    } catch (error) {
      _tapGoDebugLog('[TapGo Push] start dilewati: $error');
    }
  }

  Future<void> _register(String token) async {
    try {
      await register(token);
      _token = token;
    } catch (error) {
      _tapGoDebugLog('[TapGo Push] pendaftaran token dilewati: $error');
    }
  }

  /// Berhenti dan cabut token perangkat ini dari akun. Panggil SEBELUM access
  /// token dihapus, karena endpoint hapus memerlukan login.
  Future<void> stop() async {
    _started = false;
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    _subscriptions.clear();
    final token = _token;
    _token = null;
    try {
      if (token != null) {
        await unregister(token);
      }
      await platform.deleteToken();
    } catch (error) {
      _tapGoDebugLog('[TapGo Push] stop dilewati: $error');
    }
  }
}

/// Seam uji: mengganti platform Firebase dengan palsu.
TapGoPushPlatform? tapGoPushPlatformForTests;

TapGoPushController? _tapGoPushController;

TapGoPushController _tapGoPush() {
  return _tapGoPushController ??= TapGoPushController(
    platform: tapGoPushPlatformForTests ?? FirebasePushPlatform(),
    register: _apiClient.registerPushToken,
    unregister: _apiClient.unregisterPushToken,
    onForeground: _tapGoShowForegroundPush,
    onOpened: _tapGoOpenFromPush,
  );
}

/// Dipanggil setelah pengguna masuk.
void tapGoStartPush() {
  if (_tapGoRunningUnderTest && tapGoPushPlatformForTests == null) {
    return;
  }
  unawaited(_tapGoPush().start());
}

/// Dipanggil sebelum sesi dihapus (logout).
Future<void> tapGoStopPush() async {
  final controller = _tapGoPushController;
  if (controller == null) {
    return;
  }
  await controller.stop();
}

void _tapGoShowForegroundPush(TapGoPushMessage message) {
  final text = [message.title, message.body].where((s) => s.isNotEmpty).join('\n');
  if (text.isEmpty) {
    return;
  }
  final reference = tapGoRideReferenceFromPush(message.data);
  _tapGoScaffoldMessengerKey.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(text),
        action: reference == null
            ? null
            : SnackBarAction(
                label: 'Lihat',
                onPressed: () => _tapGoOpenRide(reference),
              ),
      ),
    );
}

void _tapGoOpenFromPush(TapGoPushMessage message) {
  final reference = tapGoRideReferenceFromPush(message.data);
  if (reference != null) {
    _tapGoOpenRide(reference);
  }
}

void _tapGoOpenRide(String reference) {
  _tapGoNavigatorKey.currentState?.push(
    MaterialPageRoute<void>(
      builder: (_) => RideStatusScreen(reference: reference),
    ),
  );
}
