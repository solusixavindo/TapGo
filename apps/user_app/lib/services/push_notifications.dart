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

  /// Membunyikan peringatan untuk satu peristiwa SAAT APP DI DEPAN. FCM hanya
  /// menampilkan notifikasi otomatis di latar belakang; di depan pesan sampai
  /// ke [foregroundMessages] tanpa bunyi apa pun (SnackBar tidak bersuara).
  /// Aplikasi di depan = ringtone notifikasi bawaan HP (tidak bergantung pada
  /// notifikasi); selain itu (atau bila ringtone gagal) = SATU notifikasi lokal
  /// di channel `tapgo_alerts_v3`. Tidak pernah keduanya untuk peristiwa yang sama.
  Future<void> showForegroundAlert(TapGoPushMessage message);
}

/// Channel notifikasi untuk pembaruan perjalanan, chat, saldo, dan pembayaran.
/// Suara/prioritas channel yang sudah ada tidak berubah oleh pemasangan baru,
/// dan channel lama (`tapgo_default`, `tapgo_alerts_v2`) sudah terkunci di HP
/// yang pernah memasang APK lama, jadi suara yang diubah SELALU membutuhkan id
/// baru. v3 memakai berkas suara aplikasi (res/raw/tapgo_alert). Dibuat di
/// MainActivity.onCreate; id HARUS sama dengan manifest
/// (default_notification_channel_id) dan payload FCM backend.
const tapGoAlertChannelId = 'tapgo_alerts_v3';
const tapGoAlertChannelName = 'Peringatan TapGo';
const tapGoAlertChannelDescription =
    'Pembaruan perjalanan, pesan chat, saldo, dan pembayaran';

/// Nama dan method HARUS sama dengan MainActivity.kt.
const tapGoAlertsMethodChannel = MethodChannel('tapgo.user/alerts');

/// Rincian notifikasi lokal: channel baru, Importance.high, suara menyala.
/// Tanpa `sound: null` dan tanpa `silent: true`.
NotificationDetails tapGoAlertNotificationDetails() =>
    const NotificationDetails(
      android: AndroidNotificationDetails(
        tapGoAlertChannelId,
        tapGoAlertChannelName,
        channelDescription: tapGoAlertChannelDescription,
        importance: Importance.high,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
      ),
    );

/// Memutar ringtone notifikasi bawaan HP lewat MethodChannel. false bila gagal.
Future<bool> tapGoPlayNotificationRingtone() async {
  try {
    return await tapGoAlertsMethodChannel
            .invokeMethod<bool>('playNotificationSound') ??
        false;
  } catch (_) {
    return false;
  }
}

class FirebasePushPlatform implements TapGoPushPlatform {
  FirebasePushPlatform({
    Future<bool> Function()? playRingtone,
    Future<void> Function(
            int id, String title, String body, NotificationDetails details)?
        showLocal,
    bool Function()? isForeground,
  })  : _playRingtone = playRingtone ?? tapGoPlayNotificationRingtone,
        _showLocalOverride = showLocal,
        _isForeground = isForeground ?? _appIsInForeground;

  static bool _appIsInForeground() {
    final state = WidgetsBinding.instance.lifecycleState;
    return state == null || state == AppLifecycleState.resumed;
  }

  final Future<bool> Function() _playRingtone;
  final Future<void> Function(
          int id, String title, String body, NotificationDetails details)?
      _showLocalOverride;
  final bool Function() _isForeground;

  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  bool _localNotificationsInitialized = false;
  int _notificationId = 0;

  Future<void> _ensureLocalNotificationsInitialized() async {
    if (_localNotificationsInitialized) {
      return;
    }
    try {
      await _localNotifications.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
      );
      _localNotificationsInitialized = true;
    } catch (error) {
      _tapGoDebugLog('[TapGo Push] notifikasi lokal gagal init: $error');
    }
  }

  @override
  Future<void> showForegroundAlert(TapGoPushMessage message) async {
    if (message.title.isEmpty && message.body.isEmpty) {
      return;
    }
    // Aplikasi di depan: ringtone, BUKAN notifikasi (satu peristiwa = satu bunyi).
    if (_isForeground() && await _playRingtone()) {
      return;
    }
    // Di belakang, atau ringtone gagal: tepat satu notifikasi di channel baru.
    try {
      final override = _showLocalOverride;
      if (override != null) {
        await override(_notificationId++, message.title, message.body,
            tapGoAlertNotificationDetails());
        return;
      }
      await _ensureLocalNotificationsInitialized();
      if (!_localNotificationsInitialized) {
        return;
      }
      await _localNotifications.show(
        _notificationId++,
        message.title,
        message.body,
        tapGoAlertNotificationDetails(),
      );
    } catch (error) {
      // Dicatat juga di rilis (sebelumnya ditelan diam-diam): hanya jenis
      // galat, tanpa isi pesan.
      debugPrint('[TapGo Push] notifikasi peringatan gagal: ${error.runtimeType}');
    }
  }

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
    this.shouldAlert,
  });

  final TapGoPushPlatform platform;
  final Future<void> Function(String token) register;
  final Future<void> Function(String token) unregister;
  final void Function(TapGoPushMessage message) onForeground;
  final void Function(TapGoPushMessage message) onOpened;

  /// Menentukan apakah pesan latar depan juga dibunyikan lewat notifikasi
  /// sistem; null = selalu. Dipakai agar pesan chat tidak berbunyi ganda saat
  /// layar chat perjalanan itu sedang terbuka.
  final bool Function(TapGoPushMessage message)? shouldAlert;

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
        ..add(platform.foregroundMessages.listen(
          (message) {
            onForeground(message);
            if (shouldAlert?.call(message) ?? true) {
              unawaited(platform.showForegroundAlert(message));
            }
          },
          onError: (_) {},
        ))
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
    // Dua langkah terpisah: bila pencabutan di server gagal (sesi sudah mati,
    // offline), token lokal tetap dihapus supaya FCM menganggapnya tidak
    // berlaku dan HP ini berhenti menerima notifikasi akun tersebut.
    if (token != null) {
      try {
        await unregister(token);
      } catch (error) {
        _tapGoDebugLog('[TapGo Push] pencabutan di server dilewati: $error');
      }
    }
    try {
      await platform.deleteToken();
    } catch (error) {
      _tapGoDebugLog('[TapGo Push] hapus token lokal dilewati: $error');
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
    shouldAlert: tapGoShouldAlertForeground,
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
  // Catatan "pencarian dilanjutkan" milik sesi ini tidak boleh terbawa ke akun lain.
  tapGoSearchContinuesRefs.value = const {};
  final controller = _tapGoPushController;
  if (controller == null) {
    return;
  }
  await controller.stop();
}

/// Perjalanan yang barusan mendapat pemberitahuan "pencarian dilanjutkan"
/// (seorang driver menolak tawaran; status order TIDAK berubah). Dibaca
/// RideStatusScreen untuk menampilkan satu baris di kartu mencari driver.
final ValueNotifier<Set<String>> tapGoSearchContinuesRefs =
    ValueNotifier<Set<String>>(const {});

/// Hook uji: menjalankan penanganan push latar depan tanpa Firebase.
@visibleForTesting
void tapGoShowForegroundPushForTests(TapGoPushMessage message) =>
    _tapGoShowForegroundPush(message);

/// Referensi chat perjalanan yang layar chat-nya SEDANG terbuka (null bila
/// tidak ada). Diisi RideChatScreen. Pesan untuk perjalanan itu cukup masuk ke
/// daftar chat: tidak ada popup dan tidak ada bunyi tambahan.
String? tapGoOpenChatReference;

/// Perjalanan yang popup chat-nya sedang tampil, supaya pesan beruntun tidak
/// menumpuk popup.
final Set<String> _tapGoChatPopupRefs = <String>{};

/// Bunyi otomatis untuk push latar depan. Pesan chat TIDAK termasuk: popup dan
/// bunyinya satu pintu lewat [_tapGoAlertChat] (juga dipakai pemantau kotak
/// masuk), supaya push dan kotak masuk tidak menggandakan peringatan.
bool tapGoShouldAlertForeground(TapGoPushMessage message) {
  return message.data['type'] != 'chat_message';
}

final Map<String, DateTime> _tapGoChatAlertAt = <String, DateTime>{};

/// Peringatan pesan chat baru: popup di dalam aplikasi + SATU bunyi. Tidak ada
/// bila layar chat perjalanan itu terbuka (pesan masuk lewat polling layar itu)
/// atau bila perjalanan yang sama sudah diperingatkan dalam 8 detik terakhir
/// (push dan pemantau kotak masuk dapat melaporkan pesan yang sama).
bool _tapGoAlertChat(TapGoPushMessage message, String reference) {
  if (reference == tapGoOpenChatReference) return false;
  final now = tapGoClockForTests();
  final last = _tapGoChatAlertAt[reference];
  if (last != null && now.difference(last) < const Duration(seconds: 8)) {
    return false;
  }
  _tapGoChatAlertAt[reference] = now;
  _tapGoShowChatPopup(message, reference);
  final controller = _tapGoPushController;
  final platform = controller?.platform ?? tapGoPushPlatformForTests;
  if (platform != null) unawaited(platform.showForegroundAlert(message));
  return true;
}

void _tapGoShowForegroundPush(TapGoPushMessage message) {
  final text = [message.title, message.body].where((s) => s.isNotEmpty).join('\n');
  if (text.isEmpty) {
    return;
  }
  final reference = tapGoRideReferenceFromPush(message.data);
  // Informasi, bukan peristiwa: dicatat untuk kartu mencari driver, tanpa
  // SnackBar dan tanpa mengubah status yang tampil.
  if (message.data['type'] == 'ride_search_continues') {
    if (reference != null) {
      tapGoSearchContinuesRefs.value = {...tapGoSearchContinuesRefs.value, reference};
    }
    return;
  }
  if (message.data['type'] == 'chat_message') {
    // Pesan chat baru: segarkan kotak masuk agar lencana ikut naik.
    _tapGoPushInvalidateChat?.call();
    if (reference != null) {
      _tapGoAlertChat(message, reference);
      return;
    }
  }
  _tapGoScaffoldMessengerKey.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(text),
        action: reference == null
            ? null
            : SnackBarAction(
                label: 'Lihat',
                onPressed: () => message.data['type'] == 'chat_message'
                    ? _tapGoOpenChat(reference)
                    : _tapGoOpenRide(reference),
              ),
      ),
    );
}

/// Popup di dalam aplikasi untuk pesan chat baru saat layar chat-nya tidak
/// terbuka. Tidak memuat isi pesan (push memang hanya membawa judul peran
/// pengirim), dengan tombol yang membuka chat perjalanan itu. Mengembalikan
/// false bila tidak ada tempat menampilkannya (pemanggil memakai SnackBar).
bool _tapGoShowChatPopup(TapGoPushMessage message, String reference) {
  final context = _tapGoNavigatorKey.currentState?.overlay?.context;
  if (context == null) {
    return false;
  }
  if (!_tapGoChatPopupRefs.add(reference)) {
    return true; // popup untuk perjalanan ini sudah tampil
  }
  unawaited(
    showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const ValueKey('chat-popup'),
        icon: const Icon(Icons.chat_bubble_rounded, color: _brandBlue),
        title: Text(message.title.isEmpty ? 'Pesan baru' : message.title),
        content: const Text('Ketuk "Buka chat" untuk membaca dan membalas.'),
        actions: [
          TextButton(
            key: const ValueKey('chat-popup-later'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Nanti'),
          ),
          FilledButton(
            key: const ValueKey('chat-popup-open'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Buka chat'),
          ),
        ],
      ),
    ).then((open) {
      _tapGoChatPopupRefs.remove(reference);
      if (open == true) {
        _tapGoOpenChat(reference);
      }
    }),
  );
  return true;
}

/// Diisi TapGoUserApp; dipakai push latar depan untuk menyegarkan lencana chat.
void Function()? _tapGoPushInvalidateChat;

void _tapGoOpenFromPush(TapGoPushMessage message) {
  final reference = tapGoRideReferenceFromPush(message.data);
  if (reference == null) {
    return;
  }
  if (message.data['type'] == 'chat_message') {
    _tapGoOpenChat(reference);
    return;
  }
  if (message.data['type'] == 'ride_search_continues') {
    // Catatan yang sama dengan penerimaan di depan, supaya layar status tidak
    // menunggu poll berikutnya untuk menampilkan pemberitahuannya.
    tapGoSearchContinuesRefs.value = {...tapGoSearchContinuesRefs.value, reference};
  }
  _tapGoOpenRide(reference);
}

void _tapGoOpenChat(String reference) {
  _tapGoNavigatorKey.currentState?.push(
    MaterialPageRoute<void>(
      builder: (_) => RideChatScreen(rideReference: reference),
    ),
  );
}

void _tapGoOpenRide(String reference) {
  _tapGoNavigatorKey.currentState?.push(
    MaterialPageRoute<void>(
      builder: (_) => RideStatusScreen(reference: reference),
    ),
  );
}

// --- Seam uji ---------------------------------------------------------------

@visibleForTesting
GlobalKey<NavigatorState> get tapGoNavigatorKeyForTests => _tapGoNavigatorKey;

@visibleForTesting
GlobalKey<ScaffoldMessengerState> get tapGoScaffoldMessengerKeyForTests =>
    _tapGoScaffoldMessengerKey;

/// Menjalankan penanganan ketukan notifikasi tanpa Firebase.
@visibleForTesting
void tapGoOpenFromPushForTests(TapGoPushMessage message) =>
    _tapGoOpenFromPush(message);

/// Mengosongkan status UI push global antar uji.
@visibleForTesting
void tapGoResetPushUiForTests() {
  tapGoOpenChatReference = null;
  _tapGoChatPopupRefs.clear();
  _tapGoChatAlertAt.clear();
  tapGoClockForTests = DateTime.now;
  tapGoPushPlatformForTests = null;
  tapGoChatConversationsLoaderForTests = null;
  tapGoSearchContinuesRefs.value = const {};
}
