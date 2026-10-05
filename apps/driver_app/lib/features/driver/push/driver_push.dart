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
  /// aksi apa pun selain menyegarkan daftar pesanan atau memberi tahu ada
  /// pesan chat baru.
  String? get type {
    final value = data['type'];
    return value == 'ride_offer' ||
            value == 'ride_cancelled' ||
            value == 'chat_message'
        ? value
        : null;
  }

  /// Referensi perjalanan dari data push bila bentuknya sah; data push tidak
  /// dipercaya mentah.
  String? get rideReference {
    final value = data['rideReference'];
    return value != null && _driverRideReferencePattern.hasMatch(value)
        ? value
        : null;
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

final _driverRideReferencePattern = RegExp(r'^RID-[A-Z0-9]{6,20}$');

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

  /// Membunyikan peringatan untuk satu peristiwa yang terjadi SAAT APP DI DEPAN:
  /// aplikasi di depan = ringtone notifikasi bawaan HP (tidak bergantung pada
  /// notifikasi, yang channel-nya dapat terkunci senyap); selain itu (atau bila
  /// ringtone gagal) = SATU notifikasi lokal di channel `tapgo_alerts_v2`.
  /// Tidak pernah keduanya untuk peristiwa yang sama.
  ///
  /// Latar belakang: menampilkan notifikasi SISTEM (dengan suara) untuk pesan yang datang
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

/// Channel notifikasi untuk order, chat, dan pembaruan perjalanan. Suara dan
/// prioritas channel yang sudah ada tidak berubah oleh pemasangan baru, dan
/// channel lama (`tapgo_default`, `tapgo_alerts_v2`) sudah terkunci di HP yang
/// pernah memasang APK lama, jadi suara yang diubah SELALU membutuhkan id baru.
/// v3 memakai berkas suara aplikasi (res/raw/tapgo_alert), bukan nada bawaan HP.
/// Dibuat di MainActivity.onCreate; id HARUS sama dengan manifest
/// (default_notification_channel_id) dan payload FCM backend.
const driverAlertChannelId = 'tapgo_alerts_v3';
const driverAlertChannelName = 'Peringatan TapGo';
const driverAlertChannelDescription =
    'Order baru, pesan chat, dan pembaruan perjalanan yang harus berbunyi';

/// Nama dan method HARUS sama dengan MainActivity.kt.
const driverAlertsMethodChannel = MethodChannel('tapgo.driver/alerts');

/// Rincian notifikasi lokal: channel baru, Importance.high, suara menyala.
/// Tanpa `sound: null` dan tanpa `silent: true`.
NotificationDetails driverAlertNotificationDetails() =>
    const NotificationDetails(
      android: AndroidNotificationDetails(
        driverAlertChannelId,
        driverAlertChannelName,
        channelDescription: driverAlertChannelDescription,
        importance: Importance.high,
        priority: Priority.high,
        playSound: true,
        enableVibration: true,
      ),
    );

/// Memutar ringtone notifikasi bawaan HP lewat MethodChannel. false bila gagal.
Future<bool> driverPlayNotificationRingtone() async {
  try {
    return await driverAlertsMethodChannel
            .invokeMethod<bool>('playNotificationSound') ??
        false;
  } catch (_) {
    return false;
  }
}

class FirebaseDriverPushPlatform implements DriverPushPlatform {
  FirebaseDriverPushPlatform({
    Future<bool> Function()? playRingtone,
    Future<void> Function(
            int id, String title, String body, NotificationDetails details)?
        showLocal,
    bool Function()? isForeground,
  })  : _playRingtone = playRingtone ?? driverPlayNotificationRingtone,
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
    // Aplikasi di depan: ringtone, BUKAN notifikasi (satu peristiwa = satu bunyi).
    if (_isForeground() && await _playRingtone()) return;
    // Di belakang, atau ringtone gagal: tepat satu notifikasi di channel baru.
    try {
      final override = _showLocalOverride;
      if (override != null) {
        await override(_notificationId++, message.title, message.body,
            driverAlertNotificationDetails());
        return;
      }
      await _ensureLocalNotificationsInitialized();
      if (!_localNotificationsInitialized) return;
      await _localNotifications.show(
        _notificationId++,
        message.title,
        message.body,
        driverAlertNotificationDetails(),
      );
    } catch (error) {
      // Dicatat juga di rilis (sebelumnya ditelan diam-diam sehingga tidak ada
      // jejak mengapa tidak berbunyi). Hanya jenis galat, tanpa isi pesan.
      debugPrint('[TapGo Push] notifikasi peringatan gagal: ${error.runtimeType}');
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
    this.shouldAlert,
  });

  final DriverPushPlatform platform;
  final Future<void> Function(String token) register;
  final Future<void> Function(String token) unregister;

  /// Dipanggil untuk pesan latar depan maupun notifikasi yang diketuk.
  final void Function(DriverPushMessage message, {required bool opened})
      onMessage;

  /// Menentukan apakah pesan latar depan juga dibunyikan lewat notifikasi
  /// sistem; null = selalu. Mencegah bunyi ganda (push + lembar tawaran) dan
  /// bunyi untuk chat yang layarnya sedang terbuka.
  final bool Function(DriverPushMessage message)? shouldAlert;

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
            if (shouldAlert?.call(m) ?? true) {
              unawaited(platform.showForegroundAlert(m));
            }
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

// ---------------------------------------------------------------------------
// Pesan chat baru: popup di dalam aplikasi
// ---------------------------------------------------------------------------

/// Referensi perjalanan yang layar chat-nya SEDANG terbuka (null bila tidak
/// ada). Pesan untuk perjalanan itu cukup masuk ke daftar chat lewat polling:
/// tanpa popup dan tanpa bunyi tambahan.
String? driverOpenChatReference;

/// Perjalanan yang popup chat-nya sedang tampil, supaya pesan beruntun tidak
/// menumpuk popup.
final Set<String> _driverChatPopupRefs = <String>{};

/// Membuka layar chat perjalanan dari mana pun (popup atau ketukan notifikasi).
void driverOpenChat(String reference) {
  driverNavigatorKey.currentState?.push(
    MaterialPageRoute<void>(
      builder: (_) => RideChatScreen(rideReference: reference),
    ),
  );
}

/// Popup untuk pesan chat baru saat layar chat-nya tidak terbuka. Tidak memuat
/// isi pesan (push memang hanya membawa judul peran pengirim), dengan tombol
/// yang membuka chat perjalanan itu. Mengembalikan false bila belum ada
/// navigator untuk menampilkannya.
bool driverShowChatPopup(DriverPushMessage message, String reference) {
  final context = driverNavigatorKey.currentState?.overlay?.context;
  if (context == null) return false;
  if (!_driverChatPopupRefs.add(reference)) {
    return true; // popup untuk perjalanan ini sudah tampil
  }
  unawaited(
    showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const ValueKey('chat-popup'),
        icon: Icon(Icons.chat_bubble_rounded,
            color: Theme.of(dialogContext).colorScheme.primary),
        title: Text(message.title.trim().isEmpty
            ? 'Pesan baru dari penumpang'
            : message.title),
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
      _driverChatPopupRefs.remove(reference);
      if (open == true) driverOpenChat(reference);
    }),
  );
  return true;
}

/// Mengosongkan status UI chat global antar uji.
@visibleForTesting
void driverResetChatUiForTests() {
  driverOpenChatReference = null;
  _driverChatPopupRefs.clear();
}

// ---------------------------------------------------------------------------
// Uji bunyi: keadaan HP yang menentukan apakah bunyi terdengar
// ---------------------------------------------------------------------------

/// Seam uji: mengganti pemanggilan MethodChannel sungguhan.
@visibleForTesting
Future<Map<String, Object?>?> Function()? driverSoundDiagnosticsForTests;

/// Meminta sisi native memutar bunyi dan melaporkan keadaan HP (izin notifikasi,
/// channel, mode dering, volume, Jangan Ganggu, nada bawaan). null bila gagal.
Future<Map<String, Object?>?> driverSoundDiagnostics() async {
  final override = driverSoundDiagnosticsForTests;
  if (override != null) return override();
  try {
    final raw = await driverAlertsMethodChannel
        .invokeMapMethod<String, Object?>('soundDiagnostics');
    return raw;
  } catch (_) {
    return null;
  }
}

/// Seam uji untuk status izin notifikasi.
@visibleForTesting
Future<bool> Function()? driverNotificationsEnabledForTests;

/// true bila notifikasi diizinkan; true juga bila tidak dapat ditentukan
/// (web, demo, galat) supaya banner tidak muncul tanpa bukti.
Future<bool> driverAreNotificationsEnabled() async {
  final override = driverNotificationsEnabledForTests;
  if (override != null) return override();
  if (kIsWeb || kDriverDemoMode) return true;
  try {
    return await driverAlertsMethodChannel
            .invokeMethod<bool>('areNotificationsEnabled') ??
        true;
  } catch (_) {
    return true;
  }
}

enum SoundCheckLevel { ok, warn, bad }

class SoundCheck {
  const SoundCheck(this.level, this.title, this.detail);
  final SoundCheckLevel level;
  final String title;
  final String detail;
}

/// Mengubah laporan native menjadi daftar pemeriksaan yang dapat dipahami
/// pengguna, lengkap dengan tindakan perbaikannya. Fungsi murni (diuji).
List<SoundCheck> driverSoundChecks(Map<String, Object?> info) {
  int? intOf(String key) => info[key] is num ? (info[key] as num).toInt() : null;
  final checks = <SoundCheck>[];

  if (info['notificationsEnabled'] == false) {
    checks.add(const SoundCheck(SoundCheckLevel.bad, 'Notifikasi dimatikan',
        'Android memblokir semua notifikasi TapGo. Buka pengaturan notifikasi dan nyalakan.'));
  } else {
    checks.add(const SoundCheck(SoundCheckLevel.ok, 'Notifikasi diizinkan', ''));
  }

  if (info['soundResourceFound'] == false) {
    checks.add(const SoundCheck(SoundCheckLevel.bad, 'Berkas suara tidak ada di aplikasi',
        'Pasang ulang aplikasi dari berkas terbaru.'));
  }

  final importance = intOf('channelImportance');
  if (info['channelExists'] == false) {
    checks.add(const SoundCheck(SoundCheckLevel.bad, 'Kategori "Peringatan TapGo" belum dibuat',
        'Tutup aplikasi sepenuhnya lalu buka lagi.'));
  } else if (importance != null && importance < 4) {
    checks.add(SoundCheck(SoundCheckLevel.bad, 'Kategori "Peringatan TapGo" tidak berstatus Penting',
        'Tingkat saat ini $importance (perlu 4). Buka pengaturan notifikasi, pilih "Peringatan TapGo", set ke Penting dengan suara.'));
  } else if (info['channelExists'] == true) {
    checks.add(const SoundCheck(SoundCheckLevel.ok, 'Kategori "Peringatan TapGo" aktif (Penting)', ''));
  }

  switch (intOf('ringerMode')) {
    case 0:
      checks.add(const SoundCheck(SoundCheckLevel.bad, 'HP dalam mode senyap',
          'Ubah mode dering ke Suara agar order terdengar.'));
    case 1:
      checks.add(const SoundCheck(SoundCheckLevel.warn, 'HP dalam mode getar',
          'Notifikasi hanya bergetar. Ubah ke Suara agar berbunyi.'));
    case 2:
      checks.add(const SoundCheck(SoundCheckLevel.ok, 'Mode dering: Suara', ''));
  }

  final volume = intOf('volumeNotification');
  final volumeMax = intOf('volumeNotificationMax');
  if (volume != null) {
    if (volume == 0) {
      checks.add(const SoundCheck(SoundCheckLevel.bad, 'Volume notifikasi nol',
          'Naikkan volume notifikasi: Pengaturan HP > Suara > Volume notifikasi.'));
    } else if (volumeMax != null && volume <= (volumeMax / 4).floor()) {
      checks.add(SoundCheck(SoundCheckLevel.warn, 'Volume notifikasi sangat rendah ($volume/$volumeMax)',
          'Naikkan volume notifikasi agar terdengar di jalan.'));
    } else {
      checks.add(SoundCheck(SoundCheckLevel.ok, 'Volume notifikasi $volume/${volumeMax ?? '?'}', ''));
    }
  }

  final dnd = intOf('dndFilter');
  if (dnd != null && dnd > 1) {
    checks.add(SoundCheck(SoundCheckLevel.bad, 'Mode Jangan Ganggu aktif',
        dnd == 4
            ? 'Hanya alarm yang berbunyi. Matikan Jangan Ganggu atau izinkan TapGo.'
            : 'Notifikasi dibisukan. Matikan Jangan Ganggu atau izinkan TapGo.'));
  }

  final playError = info['playError'];
  if (playError is String && playError.isNotEmpty) {
    checks.add(SoundCheck(SoundCheckLevel.bad, 'Bunyi gagal diputar', playError));
  } else if (info.containsKey('playError')) {
    checks.add(const SoundCheck(SoundCheckLevel.ok, 'Bunyi berhasil diputar oleh aplikasi', ''));
  }
  return checks;
}

/// Laporan teks untuk disalin dan dikirim ke tim.
String driverSoundReportText(Map<String, Object?> info) {
  final keys = info.keys.toList()..sort();
  return ['Laporan uji bunyi TapGo Driver', for (final k in keys) '$k: ${info[k]}'].join('\n');
}
