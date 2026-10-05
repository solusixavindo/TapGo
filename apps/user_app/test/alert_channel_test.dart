import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Uji HP 6 Okt 2026: bunyi tidak boleh bergantung pada channel `tapgo_default`
/// yang sudah terkunci senyap di HP. Channel BARU `tapgo_alerts_v2`; aplikasi
/// di depan memutar ringtone notifikasi bawaan (bukan notifikasi). Satu
/// peristiwa = satu bunyi.

const _ref = 'RID-A2B3C4D5E6';

typedef ShownNotification = ({int id, String title, String body, NotificationDetails details});

class ProbePlatform extends FirebasePushPlatform {
  ProbePlatform._(this.ringtone, this.shown, bool foreground, bool ringtoneWorks)
      : super(
          isForeground: () => foreground,
          playRingtone: () async {
            ringtone.add(1);
            return ringtoneWorks;
          },
          showLocal: (id, title, body, details) async =>
              shown.add((id: id, title: title, body: body, details: details)),
        );

  factory ProbePlatform({bool foreground = true, bool ringtoneWorks = true}) =>
      ProbePlatform._(<int>[], <ShownNotification>[], foreground, ringtoneWorks);

  final List<int> ringtone;
  final List<ShownNotification> shown;
  final fcm = StreamController<TapGoPushMessage>.broadcast();

  @override
  Future<String?> obtainToken() async => 'tok';
  @override
  Stream<String> get tokenRefreshes => const Stream.empty();
  @override
  Stream<TapGoPushMessage> get foregroundMessages => fcm.stream;
  @override
  Stream<TapGoPushMessage> get openedMessages => const Stream.empty();
  @override
  Future<TapGoPushMessage?> initialMessage() async => null;
  @override
  Future<void> deleteToken() async {}
}

const _chatPush = TapGoPushMessage(
  title: 'Pesan baru dari driver',
  body: 'Ketuk untuk membaca.',
  data: {'type': 'chat_message', 'rideReference': _ref},
);
const _statusPush = TapGoPushMessage(
  title: 'Driver menuju titik jemput',
  body: 'Driver sedang dalam perjalanan.',
  data: {'type': 'ride_status', 'rideReference': _ref},
);

String read(String path) => File(path).readAsStringSync();

Future<TapGoPushController> startController(ProbePlatform platform) async {
  final controller = TapGoPushController(
    platform: platform,
    register: (_) async {},
    unregister: (_) async {},
    onForeground: tapGoShowForegroundPushForTests,
    onOpened: (_) {},
    shouldAlert: tapGoShouldAlertForeground,
  );
  await controller.start();
  return controller;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(tapGoResetPushUiForTests);
  tearDown(tapGoResetPushUiForTests);

  group('rincian notifikasi lokal', () {
    test('channel baru tapgo_alerts_v2, Importance.high, suara dan getar menyala', () {
      final android = tapGoAlertNotificationDetails().android!;
      expect(android.channelId, 'tapgo_alerts_v2');
      expect(android.channelName, 'Peringatan TapGo');
      expect(android.importance, Importance.high);
      expect(android.priority, Priority.high);
      expect(android.playSound, isTrue);
      expect(android.enableVibration, isTrue);
      expect(android.sound, isNull);
      expect(android.silent, isFalse);
    });
  });

  group('satu peristiwa = satu bunyi (platform)', () {
    test('di depan: ringtone, bukan notifikasi', () async {
      final p = ProbePlatform();
      await p.showForegroundAlert(_statusPush);
      expect(p.ringtone, hasLength(1));
      expect(p.shown, isEmpty);
    });

    test('di depan tetapi ringtone gagal: satu notifikasi di channel baru', () async {
      final p = ProbePlatform(ringtoneWorks: false);
      await p.showForegroundAlert(_statusPush);
      expect(p.shown, hasLength(1));
      expect(p.shown.single.details.android!.channelId, 'tapgo_alerts_v2');
      expect(p.shown.single.details.android!.channelId, isNot('tapgo_default'));
    });

    test('di belakang: hanya notifikasi channel baru, ringtone tidak disentuh', () async {
      final p = ProbePlatform(foreground: false);
      await p.showForegroundAlert(_chatPush);
      expect(p.ringtone, isEmpty);
      expect(p.shown, hasLength(1));
      expect(p.shown.single.details.android!.channelId, 'tapgo_alerts_v2');
      expect(p.shown.single.title, 'Pesan baru dari driver');
    });
  });

  group('push latar depan lewat controller', () {
    test('peristiwa perjalanan berbunyi tepat sekali (ringtone), tanpa notifikasi', () async {
      final p = ProbePlatform();
      final c = await startController(p);
      p.fcm.add(_statusPush);
      await Future<void>.delayed(Duration.zero);
      expect(p.ringtone, hasLength(1));
      expect(p.shown, isEmpty);
      await c.stop();
    });

    test('chat untuk layar chat yang TERBUKA: tanpa bunyi', () async {
      final p = ProbePlatform();
      tapGoOpenChatReference = _ref;
      final c = await startController(p);
      p.fcm.add(_chatPush);
      await Future<void>.delayed(Duration.zero);
      expect(p.ringtone, isEmpty);
      expect(p.shown, isEmpty);
      await c.stop();
    });

    test('chat saat layar chat TIDAK terbuka: satu bunyi', () async {
      final p = ProbePlatform();
      final c = await startController(p);
      p.fcm.add(_chatPush);
      await Future<void>.delayed(Duration.zero);
      expect(p.ringtone, hasLength(1));
      expect(p.shown, isEmpty);
      await c.stop();
    });
  });

  group('MethodChannel ringtone', () {
    tearDown(() => TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(tapGoAlertsMethodChannel, null));

    test('memanggil playNotificationSound pada channel tapgo.user/alerts', () async {
      final calls = <String>[];
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(tapGoAlertsMethodChannel, (call) async {
        calls.add(call.method);
        return true;
      });
      expect(await tapGoPlayNotificationRingtone(), isTrue);
      expect(calls, ['playNotificationSound']);
      expect(tapGoAlertsMethodChannel.name, 'tapgo.user/alerts');
    });

    test('sisi native gagal atau tidak ada: false (bukan lemparan)', () async {
      expect(await tapGoPlayNotificationRingtone(), isFalse);
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(tapGoAlertsMethodChannel, (call) async {
        throw PlatformException(code: 'x');
      });
      expect(await tapGoPlayNotificationRingtone(), isFalse);
    });
  });

  group('popup chat tetap ada dan satu bunyi', () {
    testWidgets('layar chat tidak terbuka: popup + tepat satu ringtone', (tester) async {
      final p = ProbePlatform();
      await tester.pumpWidget(MaterialApp(
        navigatorKey: tapGoNavigatorKeyForTests,
        home: const Scaffold(body: Text('beranda')),
      ));
      final c = (await tester.runAsync(() => startController(p)))!;
      p.fcm.add(_chatPush);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
      expect(p.ringtone, hasLength(1));
      await tester.runAsync(c.stop);
    });
  });

  group('berkas Android', () {
    final kotlin = read('android/app/src/main/kotlin/com/xavindo/tapgo/MainActivity.kt');
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

    test('MethodChannel tapgo.user/alerts memutar ringtone lewat RingtoneManager', () {
      expect(kotlin, contains('"tapgo.user/alerts"'));
      expect(kotlin, contains('"playNotificationSound"'));
      expect(kotlin, contains('RingtoneManager.getRingtone(applicationContext'));
    });

    test('manifest: channel default FCM ikut tapgo_alerts_v2', () {
      expect(manifest, contains('android:value="tapgo_alerts_v2"'));
    });

    test('tapgo_default tidak lagi dipakai (Kotlin, manifest, Dart)', () {
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

    test('tidak ada izin RECORD_AUDIO atau USE_FULL_SCREEN_INTENT', () {
      expect(manifest, isNot(contains('RECORD_AUDIO')));
      expect(manifest, isNot(contains('USE_FULL_SCREEN_INTENT')));
      expect(manifest, isNot(contains('ACCESS_NOTIFICATION_POLICY')));
      expect(kotlin, isNot(contains('setBypassDnd')));
    });
  });
}
