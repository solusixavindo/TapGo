import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

/// Uji HP 6 Okt 2026: driver +10 tidak berbunyi. Channel `tapgo_default` sudah
/// dibuat oleh APK lama di HP dan suaranya tidak dapat diubah pemasangan baru
/// (Android 8+), jadi peringatan memakai channel BARU `tapgo_alerts_v2` dan,
/// saat aplikasi di depan, ringtone notifikasi bawaan HP (tidak bergantung pada
/// notifikasi). Satu peristiwa = satu bunyi.

DriverPushMessage msg(String type, {String title = 'Order baru', String body = 'Ada penumpang'}) =>
    DriverPushMessage(
      title: title,
      body: body,
      data: {'type': type, 'rideReference': 'RID-A2B3C4D5E6'},
    );

typedef ShownNotification = ({int id, String title, String body, NotificationDetails details});

FirebaseDriverPushPlatform platformWith({
  required bool foreground,
  required bool ringtoneWorks,
  required List<int> ringtoneCalls,
  required List<ShownNotification> shown,
}) {
  return FirebaseDriverPushPlatform(
    isForeground: () => foreground,
    playRingtone: () async {
      ringtoneCalls.add(1);
      return ringtoneWorks;
    },
    showLocal: (id, title, body, details) async =>
        shown.add((id: id, title: title, body: body, details: details)),
  );
}

String read(String path) => File(path).readAsStringSync();

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('rincian notifikasi lokal', () {
    test('channel baru tapgo_alerts_v2, Importance.high, suara dan getar menyala', () {
      final android = driverAlertNotificationDetails().android!;
      expect(android.channelId, 'tapgo_alerts_v2');
      expect(android.channelName, 'Peringatan TapGo');
      expect(android.importance, Importance.high);
      expect(android.priority, Priority.high);
      expect(android.playSound, isTrue);
      expect(android.enableVibration, isTrue);
      // Tanpa sound: null dan tanpa silent: true.
      expect(android.sound, isNull);
      expect(android.silent, isFalse);
    });
  });

  group('satu peristiwa = satu bunyi', () {
    test('aplikasi di depan: ringtone diputar, TIDAK ada notifikasi lokal', () async {
      final ringtone = <int>[];
      final shown = <ShownNotification>[];
      final platform = platformWith(
          foreground: true, ringtoneWorks: true, ringtoneCalls: ringtone, shown: shown);
      await platform.showForegroundAlert(msg('ride_offer'));
      expect(ringtone, hasLength(1));
      expect(shown, isEmpty);
    });

    test('di depan tetapi ringtone gagal: tepat satu notifikasi di channel baru', () async {
      final ringtone = <int>[];
      final shown = <ShownNotification>[];
      final platform = platformWith(
          foreground: true, ringtoneWorks: false, ringtoneCalls: ringtone, shown: shown);
      await platform.showForegroundAlert(msg('ride_offer'));
      expect(ringtone, hasLength(1));
      expect(shown, hasLength(1));
      expect(shown.single.details.android!.channelId, 'tapgo_alerts_v2');
      expect(shown.single.details.android!.channelId, isNot('tapgo_default'));
    });

    test('di belakang: hanya notifikasi channel tapgo_alerts_v2; ringtone tidak disentuh', () async {
      final ringtone = <int>[];
      final shown = <ShownNotification>[];
      final platform = platformWith(
          foreground: false, ringtoneWorks: true, ringtoneCalls: ringtone, shown: shown);
      await platform.showForegroundAlert(msg('chat_message', title: 'Pesan baru dari penumpang'));
      expect(ringtone, isEmpty);
      expect(shown, hasLength(1));
      expect(shown.single.details.android!.channelId, 'tapgo_alerts_v2');
      expect(shown.single.details.android!.playSound, isTrue);
      expect(shown.single.title, 'Pesan baru dari penumpang');
    });

    test('pesan tanpa judul dan isi tidak berbunyi', () async {
      final ringtone = <int>[];
      final shown = <ShownNotification>[];
      final platform = platformWith(
          foreground: true, ringtoneWorks: true, ringtoneCalls: ringtone, shown: shown);
      await platform.showForegroundAlert(const DriverPushMessage(title: '', body: ''));
      expect(ringtone, isEmpty);
      expect(shown, isEmpty);
    });

    test('kegagalan menampilkan notifikasi tidak melempar', () async {
      final platform = FirebaseDriverPushPlatform(
        isForeground: () => false,
        showLocal: (_, __, ___, ____) async => throw StateError('gagal'),
      );
      await platform.showForegroundAlert(msg('ride_offer'));
    });
  });

  group('MethodChannel ringtone', () {
    final messenger = TestDefaultBinaryMessenger(TestWidgetsFlutterBinding.instance.defaultBinaryMessenger);

    tearDown(() => TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(driverAlertsMethodChannel, null));

    test('memanggil playNotificationSound pada channel tapgo.driver/alerts', () async {
      final calls = <String>[];
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(driverAlertsMethodChannel, (call) async {
        calls.add(call.method);
        return true;
      });
      expect(await driverPlayNotificationRingtone(), isTrue);
      expect(calls, ['playNotificationSound']);
      expect(driverAlertsMethodChannel.name, 'tapgo.driver/alerts');
      expect(messenger, isNotNull);
    });

    test('sisi native gagal atau tidak ada: false (bukan lemparan)', () async {
      expect(await driverPlayNotificationRingtone(), isFalse); // belum ada handler
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(driverAlertsMethodChannel, (call) async {
        throw PlatformException(code: 'x');
      });
      expect(await driverPlayNotificationRingtone(), isFalse);
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(driverAlertsMethodChannel, (call) async => false);
      expect(await driverPlayNotificationRingtone(), isFalse);
    });
  });

  group('berkas Android: channel baru, suara eksplisit, tanpa izin terlarang', () {
    final kotlin = read(
        'android/app/src/main/kotlin/com/xavindo/tapgo/driver/MainActivity.kt');
    final manifest = read('android/app/src/main/AndroidManifest.xml');

    test('MainActivity membuat tapgo_alerts_v2 di onCreate dengan suara eksplisit', () {
      expect(kotlin, contains('"tapgo_alerts_v2"'));
      expect(kotlin, contains('"Peringatan TapGo"'));
      expect(kotlin, contains('NotificationManager.IMPORTANCE_HIGH'));
      expect(kotlin, contains('enableVibration(true)'));
      expect(kotlin, contains('RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)'));
      expect(kotlin, contains('AudioAttributes.USAGE_NOTIFICATION'));
      expect(kotlin, isNot(contains('setSound(null')));
      final onCreate = kotlin.substring(kotlin.indexOf('override fun onCreate'));
      expect(onCreate.indexOf('createAlertNotificationChannel()'),
          lessThan(onCreate.indexOf('override fun configureFlutterEngine')));
    });

    test('MethodChannel tapgo.driver/alerts memutar ringtone lewat RingtoneManager', () {
      expect(kotlin, contains('"tapgo.driver/alerts"'));
      expect(kotlin, contains('"playNotificationSound"'));
      expect(kotlin, contains('RingtoneManager.getRingtone(applicationContext'));
    });

    test('manifest: channel default FCM ikut tapgo_alerts_v2', () {
      expect(manifest,
          contains('com.google.firebase.messaging.default_notification_channel_id'));
      expect(manifest, contains('android:value="tapgo_alerts_v2"'));
    });

    test('tapgo_default tidak lagi dipakai untuk peringatan (Kotlin, manifest, Dart)', () {
      expect(kotlin, isNot(contains('"tapgo_default"')));
      expect(manifest, isNot(contains('tapgo_default')));
      final offenders = <String>[];
      for (final file in Directory('lib').listSync(recursive: true)) {
        if (file is File && file.path.endsWith('.dart')) {
          final text = file.readAsStringSync();
          if (text.contains("'tapgo_default'") || text.contains('"tapgo_default"')) {
            offenders.add(file.path);
          }
        }
      }
      expect(offenders, isEmpty);
    });

    test('tidak ada izin RECORD_AUDIO atau USE_FULL_SCREEN_INTENT, tidak mematikan Jangan Ganggu', () {
      // RECORD_AUDIO hanya boleh muncul sebagai penghapusan (tools:node="remove").
      for (final line in manifest.split('\n')) {
        if (line.contains('uses-permission') && line.contains('RECORD_AUDIO')) {
          expect(line, contains('tools:node="remove"'));
        }
      }
      expect(manifest, isNot(contains('USE_FULL_SCREEN_INTENT')));
      expect(manifest, isNot(contains('ACCESS_NOTIFICATION_POLICY')));
      expect(kotlin, isNot(contains('setBypassDnd')));
    });

    test('notifikasi "TapGo Driver aktif" tetap di channel layanan lokasinya sendiri', () {
      final location = read('lib/features/driver/location/driver_location_port.dart');
      expect(location, contains("notificationTitle: 'TapGo Driver aktif'"));
      expect(location, contains("notificationChannelName: 'Status online driver'"));
      expect(location, isNot(contains('tapgo_alerts_v2')));
    });
  });
}
