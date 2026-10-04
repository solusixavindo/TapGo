part of '../../../main.dart';

/// Pesan push yang sudah dinormalisasi, supaya logika di bawah tidak
/// bergantung pada tipe Firebase (dan dapat diuji tanpa Firebase).
class DriverPushMessage {
  const DriverPushMessage({
    required this.title,
    required this.body,
    this.data = const {},
  });

  final String title;
  final String body;
  final Map<String, String> data;

  /// Hanya jenis yang dikenal yang dipercaya; data push tidak menentukan
  /// aksi apa pun selain menyegarkan daftar pesanan.
  String? get type {
    final value = data['type'];
    return value == 'ride_offer' || value == 'ride_cancelled' ? value : null;
  }

  /// Pesan `ride_offer` tanpa judul dan isi (data-only) diberi teks bawaan.
  /// Tanpa ini showForegroundAlert kembali diam-diam dan order masuk tidak
  /// memunculkan notifikasi sistem sama sekali. Jenis lain tidak diubah.
  DriverPushMessage withRideOfferDefaults() {
    if (type != 'ride_offer' || title.trim().isNotEmpty || body.trim().isNotEmpty) {
      return this;
    }
    return DriverPushMessage(
      title: 'Order baru',
      body: 'Ada penumpang di dekat Anda',
      data: data,
    );
  }
}

/// Batas antara aplikasi dan plugin Firebase; uji memakai implementasi palsu.
abstract class DriverPushPlatform {
  /// Meminta izin notifikasi lalu mengembalikan token FCM; null bila izin
  /// ditolak atau Firebase tidak tersedia (mis. google-services.json belum
  /// dipasang pada build ini).
  Future<String?> obtainToken();
  Stream<String> get tokenRefreshes;
  Stream<DriverPushMessage> get foregroundMessages;
  Stream<DriverPushMessage> get openedMessages;
  Future<void> deleteToken();

  /// Menampilkan notifikasi SISTEM (dengan suara) untuk pesan yang datang
  /// SAAT APP DI DEPAN — regresi Owner 29 Sep 2026: "order masuk tapi tidak
  /// ada suara dan tidak ada pop up". FCM HANYA menampilkan notifikasi
  /// otomatis untuk kondisi LATAR BELAKANG; saat app di depan, pesan hanya
  /// sampai ke [foregroundMessages] tanpa apa pun ditampilkan sistem —
  /// itulah sebabnya SnackBar (lihat onMessage di driver_controller.dart)
  /// sendirian tidak cukup, karena SnackBar tidak pernah bersuara. Dipanggil
  /// TERPISAH dari onMessage, bukan menggantikannya: SnackBar tetap berguna
  /// sebagai jejak visual di dalam app.
  Future<void> showForegroundAlert(DriverPushMessage message);
}

class FirebaseDriverPushPlatform implements DriverPushPlatform {
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  bool _localNotificationsInitialized = false;
  int _notificationId = 0;

  Future<void> _ensureLocalNotificationsInitialized() async {
    if (_localNotificationsInitialized) return;
    try {
      await _localNotifications.initialize(
        const InitializationSettings(
          // Ikon peluncur aplikasi — sama seperti yang FCM pakai otomatis
          // untuk notifikasi latar belakang, bukan aset terpisah.
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
      );
      _localNotificationsInitialized = true;
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[TapGo Push] flutter_local_notifications gagal init: $error');
      }
    }
  }

  Future<bool> _ensureInitialized() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      return true;
    } catch (error) {
      if (kDebugMode) debugPrint('[TapGo Push] Firebase tidak tersedia: $error');
      return false;
    }
  }

  static DriverPushMessage _convert(RemoteMessage message) => DriverPushMessage(
        title: message.notification?.title ?? '',
        body: message.notification?.body ?? '',
        data: {
          for (final entry in message.data.entries)
            if (entry.value is String) entry.key: entry.value as String,
        },
      );

  @override
  Future<String?> obtainToken() async {
    if (!await _ensureInitialized()) return null;
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) return null;
    return messaging.getToken();
  }

  @override
  Stream<String> get tokenRefreshes async* {
    if (await _ensureInitialized()) {
      yield* FirebaseMessaging.instance.onTokenRefresh;
    }
  }

  @override
  Stream<DriverPushMessage> get foregroundMessages async* {
    if (await _ensureInitialized()) {
      yield* FirebaseMessaging.onMessage.map(_convert);
    }
  }

  @override
  Stream<DriverPushMessage> get openedMessages async* {
    if (await _ensureInitialized()) {
      yield* FirebaseMessaging.onMessageOpenedApp.map(_convert);
    }
  }

  @override
  Future<void> deleteToken() async {
    if (await _ensureInitialized()) {
      await FirebaseMessaging.instance.deleteToken();
    }
  }

  @override
  Future<void> showForegroundAlert(DriverPushMessage message) async {
    if (message.title.isEmpty && message.body.isEmpty) return;
    try {
      await _ensureLocalNotificationsInitialized();
      if (!_localNotificationsInitialized) return;
      // Channel ID SAMA PERSIS dengan yang dibuat MainActivity.kt untuk
      // notifikasi latar belakang (IMPORTANCE_HIGH, sudah ada suaranya) —
      // memakai channel yang sama, bukan channel baru, supaya driver hanya
      // punya SATU pengaturan suara/getar untuk diatur, konsisten di kedua
      // kondisi (app di depan maupun di belakang).
      await _localNotifications.show(
        _notificationId++,
        message.title,
        message.body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'tapgo_default',
            'Pesanan dan pemberitahuan',
            channelDescription:
                'Pesanan baru di dekat Anda, pembatalan, dan pembaruan akun',
            importance: Importance.high,
            priority: Priority.high,
          ),
        ),
      );
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[TapGo Push] Gagal menampilkan notifikasi foreground: $error');
      }
    }
  }
}

/// Siklus token push untuk satu sesi masuk. Semua langkah best-effort:
/// kegagalan push tidak boleh mengganggu login, online, atau logout.
class DriverPushController {
  DriverPushController({
    required this.platform,
    required this.register,
    required this.unregister,
    required this.onMessage,
  });

  final DriverPushPlatform platform;
  final Future<void> Function(String token) register;
  final Future<void> Function(String token) unregister;

  /// Dipanggil untuk pesan latar depan maupun notifikasi yang diketuk.
  final void Function(DriverPushMessage message, {required bool opened})
      onMessage;

  final List<StreamSubscription<Object?>> _subscriptions = [];
  String? _token;
  bool _started = false;

  bool get started => _started;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    try {
      final token = await platform.obtainToken();
      if (!_started) return;
      if (token != null && token.isNotEmpty) await _register(token);
      _subscriptions
        ..add(platform.tokenRefreshes.listen(
          (token) => unawaited(_register(token)),
          onError: (_) {},
        ))
        ..add(platform.foregroundMessages.listen(
          (raw) {
            final m = raw.withRideOfferDefaults();
            onMessage(m, opened: false);
            unawaited(platform.showForegroundAlert(m));
          },
          onError: (_) {},
        ))
        ..add(platform.openedMessages.listen(
          (m) => onMessage(m, opened: true),
          onError: (_) {},
        ));
    } catch (_) {
      // Push tidak boleh menggagalkan alur utama.
    }
  }

  Future<void> _register(String token) async {
    try {
      await register(token);
      _token = token;
    } catch (_) {}
  }

  /// Panggil SEBELUM sesi dihapus: pencabutan token butuh login.
  Future<void> stop() async {
    _started = false;
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _subscriptions.clear();
    final token = _token;
    _token = null;
    if (token != null) {
      try {
        await unregister(token);
      } catch (_) {}
    }
    try {
      await platform.deleteToken();
    } catch (_) {}
  }
}
