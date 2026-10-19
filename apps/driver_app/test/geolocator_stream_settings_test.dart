import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator_android/geolocator_android.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:tapgo_driver_app/main.dart';

/// Regresi 19 Okt 2026: notifikasi layanan latar depan lokasi tidak pernah tampil di HP.
///
/// Akar: plugin geolocator_android hanya menyimpan SATU aliran posisi dan mengembalikannya ke pemanggil berikutnya
/// dengan pengaturan pemanggil PERTAMA. Peta di Beranda membuka aliran lebih dulu (tanpa konfigurasi notifikasi),
/// jadi `foregroundNotificationConfig` milik pelacakan driver tidak pernah sampai ke sisi native.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const eventChannel = EventChannel('flutter.baseflow.com/geolocator_updates_android');
  const methodChannel = MethodChannel('flutter.baseflow.com/geolocator_android');
  final listenArguments = <Object?>[];
  var methodCalls = <String>[];
  Map<String, dynamic>? lastKnown;
  var currentDelay = Duration.zero;

  setUp(() {
    listenArguments.clear();
    methodCalls = <String>[];
    lastKnown = null;
    currentDelay = Duration.zero;
    GeolocatorPlatform.instance = GeolocatorAndroid();
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockStreamHandler(
      eventChannel,
      MockStreamHandler.inline(onListen: (arguments, sink) => listenArguments.add(arguments)),
    );
    messenger.setMockMethodCallHandler(methodChannel, (call) async {
      methodCalls.add(call.method);
      switch (call.method) {
        case 'isLocationServiceEnabled':
          return true;
        case 'checkPermission':
          return LocationPermission.whileInUse.index;
        case 'getLastKnownPosition':
          return lastKnown;
        case 'getCurrentPosition':
          if (currentDelay > Duration.zero) await Future<void>.delayed(currentDelay);
          return <String, dynamic>{
            'latitude': -6.2,
            'longitude': 106.8,
            'timestamp': DateTime.now().millisecondsSinceEpoch,
            'accuracy': 5.0,
            'altitude': 0.0,
            'altitude_accuracy': 1.0,
            'heading': 0.0,
            'heading_accuracy': 1.0,
            'speed': 0.0,
            'speed_accuracy': 1.0,
            'is_mocked': false,
          };
      }
      return null;
    });
  });

  tearDown(() {
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockStreamHandler(eventChannel, null);
    messenger.setMockMethodCallHandler(methodChannel, null);
  });

  Map<Object?, Object?>? foregroundConfigOf(Object? arguments) =>
      arguments is Map ? arguments['foregroundNotificationConfig'] as Map<Object?, Object?>? : null;

  test('plugin: pemanggil kedua dengan pengaturan berbeda TIDAK memakai aliran pemanggil pertama', () async {
    final plugin = GeolocatorAndroid();
    final first = plugin
        .getPositionStream(locationSettings: AndroidSettings(accuracy: LocationAccuracy.high, distanceFilter: 10))
        .listen((_) {});
    await Future<void>.delayed(Duration.zero);
    final second = plugin
        .getPositionStream(
          locationSettings: AndroidSettings(
            accuracy: LocationAccuracy.high,
            foregroundNotificationConfig: const ForegroundNotificationConfig(
              notificationTitle: 'TapGo Driver aktif',
              notificationText: 'uji',
            ),
          ),
        )
        .listen((_) {});
    await Future<void>.delayed(Duration.zero);

    expect(listenArguments.length, 2, reason: 'pengaturan baru harus membuka aliran baru di sisi native');
    expect(foregroundConfigOf(listenArguments.first), isNull);
    expect(foregroundConfigOf(listenArguments.last), isNotNull);
    expect(foregroundConfigOf(listenArguments.last)!['notificationTitle'], 'TapGo Driver aktif');
    await first.cancel();
    await second.cancel();
  });

  test('plugin: pengaturan yang sama memakai ulang satu aliran (tidak membuka dua kali)', () async {
    final plugin = GeolocatorAndroid();
    final settings = AndroidSettings(accuracy: LocationAccuracy.high, distanceFilter: 5);
    final a = plugin.getPositionStream(locationSettings: settings).listen((_) {});
    final b = plugin.getPositionStream(locationSettings: settings).listen((_) {});
    await Future<void>.delayed(Duration.zero);
    expect(listenArguments.length, 1);
    await a.cancel();
    await b.cancel();
  });

  test('aplikasi: marker peta tampil SEKETIKA dari posisi terakhir yang diketahui, tanpa menunggu GPS mengunci', () async {
    lastKnown = <String, dynamic>{
      'latitude': -6.25,
      'longitude': 106.85,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'accuracy': 30.0,
      'altitude': 0.0,
      'altitude_accuracy': 1.0,
      'heading': 0.0,
      'heading_accuracy': 1.0,
      'speed': 0.0,
      'speed_accuracy': 1.0,
      'is_mocked': false,
    };
    currentDelay = const Duration(seconds: 3); // GPS dingin: fix presisi baru tiba lama kemudian
    final port = GeolocatorDriverLocationPort(_NoopRepository());
    final stopwatch = Stopwatch()..start();
    final first = await port.positionStream.first;
    stopwatch.stop();
    expect(first, (-6.25, 106.85));
    expect(stopwatch.elapsedMilliseconds, lessThan(1500), reason: 'tidak boleh menunggu fix presisi 3 dtk');
  });

  test('aplikasi: peta membaca posisi tanpa menyentuh saluran event, jadi pelacakan tetap membawa notifikasi', () async {
    final port = GeolocatorDriverLocationPort(_NoopRepository());
    final mapSubscription = port.positionStream.listen((_) {});
    await Future<void>.delayed(const Duration(milliseconds: 50));
    // Peta sudah aktif, TIDAK ada aliran event yang dibuka olehnya.
    expect(listenArguments, isEmpty);
    expect(methodCalls, contains('getCurrentPosition'));

    await port.startTracking();
    await Future<void>.delayed(Duration.zero);
    expect(listenArguments.length, 1);
    final config = foregroundConfigOf(listenArguments.single);
    expect(config, isNotNull, reason: 'layanan latar depan HARUS dimulai bersama pelacakan');
    expect(config!['notificationTitle'], 'TapGo Driver aktif');
    expect(config['setOngoing'], true);

    await port.stopTracking();
    await mapSubscription.cancel();
  });
}

class _NoopRepository implements DriverRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}
