import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tapgo_user_app/main.dart';

/// Uji HP 6 Okt 2026: bunyi tidak boleh bergantung pada channel `tapgo_default`
/// yang sudah terkunci senyap di HP. Channel BARU `tapgo_alerts_v3` (satu channel
/// per bunyi pilihan: tapgo, lonceng, panggilan); aplikasi di depan memutar bunyi
/// pilihan dari berkas suara aplikasi (bukan notifikasi). Satu peristiwa = satu bunyi.

const _ref = 'RID-A2B3C4D5E6';

typedef ShownNotification = ({int id, String title, String body, NotificationDetails details});

class ProbePlatform extends FirebasePushPlatform {
  ProbePlatform._(this.ringtone, this.shown, bool foreground, bool ringtoneWorks, this.tones)
      : super(
          isForeground: () => foreground,
          playRingtone: (tone) async {
            ringtone.add(1);
            tones.add(tone);
            return ringtoneWorks;
          },
          showLocal: (id, title, body, details) async =>
              shown.add((id: id, title: title, body: body, details: details)),
        );

  factory ProbePlatform({bool foreground = true, bool ringtoneWorks = true}) =>
      ProbePlatform._(<int>[], <ShownNotification>[], foreground, ringtoneWorks, <TapGoAlertTone>[]);

  final List<int> ringtone;
  final List<TapGoAlertTone> tones;
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
  // Peringatan chat satu pintu (_tapGoAlertChat) membunyikan lewat platform ini.
  tapGoPushPlatformForTests = platform;
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

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    tapGoResetPushUiForTests();
    tapGoResetAlertToneForTests();
  });
  tearDown(() {
    tapGoResetPushUiForTests();
    tapGoResetAlertToneForTests();
  });

  group('rincian notifikasi lokal', () {
    test('channel baru tapgo_alerts_v3, Importance.high, suara dan getar menyala', () {
      final android = tapGoAlertNotificationDetails().android!;
      expect(android.channelId, 'tapgo_alerts_v3');
      expect(android.channelName, 'Peringatan TapGo');
      expect(android.importance, Importance.high);
      expect(android.priority, Priority.high);
      expect(android.playSound, isTrue);
      expect(android.enableVibration, isTrue);
      expect(android.sound, isNull);
      expect(android.silent, isFalse);
    });

    test('tiga bunyi: kunci, label, dan channel berbeda; sama dengan whitelist backend', () {
      expect(TapGoAlertTone.values.map((t) => t.key), ['tapgo', 'lonceng', 'panggilan']);
      expect(TapGoAlertTone.values.map((t) => t.label), ['TapGo', 'Lonceng', 'Panggilan']);
      expect(TapGoAlertTone.values.map((t) => t.channelId).toSet(), hasLength(3));
      expect(TapGoAlertTone.lonceng.channelId, 'tapgo_alerts_v3_lonceng');
      expect(TapGoAlertTone.panggilan.channelId, 'tapgo_alerts_v3_panggilan');
      for (final tone in TapGoAlertTone.values) {
        final android = tapGoAlertNotificationDetails(tone).android!;
        expect(android.channelId, tone.channelId);
        expect(android.importance, Importance.high);
        expect(android.playSound, isTrue);
        expect(android.sound, isNull);
      }
    });

    test('kunci tak dikenal, kosong, atau berbahaya jatuh ke bunyi TapGo', () {
      expect(TapGoAlertTone.fromKey('lonceng'), TapGoAlertTone.lonceng);
      expect(TapGoAlertTone.fromKey('panggilan'), TapGoAlertTone.panggilan);
      expect(TapGoAlertTone.fromKey(null), TapGoAlertTone.tapgo);
      expect(TapGoAlertTone.fromKey(''), TapGoAlertTone.tapgo);
      expect(TapGoAlertTone.fromKey('../../etc'), TapGoAlertTone.tapgo);
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
      expect(p.shown.single.details.android!.channelId, 'tapgo_alerts_v3');
      expect(p.shown.single.details.android!.channelId, isNot('tapgo_default'));
    });

    test('di belakang: hanya notifikasi channel baru, ringtone tidak disentuh', () async {
      final p = ProbePlatform(foreground: false);
      await p.showForegroundAlert(_chatPush);
      expect(p.ringtone, isEmpty);
      expect(p.shown, hasLength(1));
      expect(p.shown.single.details.android!.channelId, 'tapgo_alerts_v3');
      expect(p.shown.single.title, 'Pesan baru dari driver');
    });
  });

  group('bunyi pilihan dipakai oleh platform', () {
    test('di depan: tepat bunyi yang dipilih diputar', () async {
      for (final tone in TapGoAlertTone.values) {
        tapGoAlertTone.value = tone;
        final p = ProbePlatform();
        await p.showForegroundAlert(_statusPush);
        expect(p.tones, [tone]);
        expect(p.shown, isEmpty);
      }
    });

    test('di belakang atau bunyi gagal: notifikasi memakai channel milik bunyi pilihan', () async {
      for (final tone in TapGoAlertTone.values) {
        tapGoAlertTone.value = tone;
        final back = ProbePlatform(foreground: false);
        await back.showForegroundAlert(_chatPush);
        expect(back.shown.single.details.android!.channelId, tone.channelId);
        final failed = ProbePlatform(ringtoneWorks: false);
        await failed.showForegroundAlert(_statusPush);
        expect(failed.shown.single.details.android!.channelId, tone.channelId);
      }
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
      final sounds = <Object?>[];
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(tapGoAlertsMethodChannel, (call) async {
        calls.add(call.method);
        sounds.add((call.arguments as Map)['sound']);
        return true;
      });
      expect(await tapGoPlayNotificationRingtone(), isTrue);
      expect(await tapGoPlayNotificationRingtone(TapGoAlertTone.lonceng), isTrue);
      expect(await tapGoPlayNotificationRingtone(TapGoAlertTone.panggilan), isTrue);
      expect(calls, ['playNotificationSound', 'playNotificationSound', 'playNotificationSound']);
      expect(sounds, ['tapgo', 'lonceng', 'panggilan']);
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
    final main = read('android/app/src/main/kotlin/com/xavindo/tapgo/MainActivity.kt');
    final sound = read('android/app/src/main/kotlin/com/xavindo/tapgo/AlertSound.kt');
    final manifest = read('android/app/src/main/AndroidManifest.xml');

    test('AlertSound membuat tiga channel (satu per bunyi) dengan berkas suara aplikasi, getar, dan USAGE_NOTIFICATION', () {
      for (final id in ['"tapgo_alerts_v3"', '"tapgo_alerts_v3_lonceng"', '"tapgo_alerts_v3_panggilan"']) {
        expect(sound, contains(id));
      }
      for (final raw in ['"tapgo_alert"', '"tapgo_alert_lonceng"', '"tapgo_alert_panggilan"']) {
        expect(sound, contains(raw));
      }
      expect(sound, contains('"Peringatan TapGo"'));
      expect(sound, contains('NotificationManager.IMPORTANCE_HIGH'));
      expect(sound, contains('enableVibration(true)'));
      expect(sound, contains('setSound(soundUri(tone), attributes())'));
      expect(sound, contains('AudioAttributes.USAGE_NOTIFICATION'));
      expect(sound, isNot(contains('setSound(null')));
      expect(sound, isNot(contains('setBypassDnd')));
    });

    test('kunci dan id channel di Kotlin sama dengan sisi Dart', () {
      for (final tone in TapGoAlertTone.values) {
        expect(sound, contains('"${tone.key}"'), reason: tone.key);
        expect(sound, contains('"${tone.channelId}"'), reason: tone.channelId);
      }
    });

    test('channel dibuat sebelum notifikasi apa pun (onCreate); tiga berkas suara ada dan tidak dibuang', () {
      final onCreate = main.substring(main.indexOf('override fun onCreate'));
      expect(onCreate.indexOf('alertSound.createChannels()'),
          lessThan(onCreate.indexOf('override fun configureFlutterEngine')));
      for (final raw in ['tapgo_alert', 'tapgo_alert_lonceng', 'tapgo_alert_panggilan']) {
        final file = File('android/app/src/main/res/raw/$raw.wav');
        expect(file.existsSync(), isTrue, reason: raw);
        expect(file.lengthSync(), greaterThan(10000), reason: raw);
        expect(read('android/app/src/main/res/raw/keep.xml'), contains('@raw/$raw'));
      }
    });

    test('MethodChannel tapgo.user/alerts: putar (dengan argumen sound), status izin, pengaturan; tanpa diagnostik', () {
      expect(main, contains('"tapgo.user/alerts"'));
      expect(main, contains('"playNotificationSound"'));
      expect(main, contains('call.argument<String>("sound")'));
      expect(main, isNot(contains('soundDiagnostics')));
      expect(main, contains('"areNotificationsEnabled"'));
      expect(main, contains('"openNotificationSettings"'));
      expect(sound, contains('MediaPlayer'));
      expect(sound, isNot(contains('diagnostics')));
    });

    test('manifest: channel default FCM ikut tapgo_alerts_v3', () {
      expect(manifest, contains('android:value="tapgo_alerts_v3"'));
    });

    test('channel lama (tapgo_default, tapgo_alerts_v2) tidak dipakai lagi', () {
      for (final old in ['tapgo_default', 'tapgo_alerts_v2']) {
        expect(main, isNot(contains('"$old"')));
        expect(sound, isNot(contains('"$old"')));
        expect(manifest, isNot(contains(old)));
        final offenders = <String>[];
        for (final file in Directory('lib').listSync(recursive: true)) {
          if (file is File && file.path.endsWith('.dart')) {
            final text = file.readAsStringSync();
            if (text.contains("'$old'") || text.contains('"$old"')) {
              offenders.add(file.path);
            }
          }
        }
        expect(offenders, isEmpty, reason: old);
      }
    });

    test('tidak ada izin RECORD_AUDIO atau USE_FULL_SCREEN_INTENT', () {
      expect(manifest, isNot(contains('RECORD_AUDIO')));
      expect(manifest, isNot(contains('USE_FULL_SCREEN_INTENT')));
      expect(manifest, isNot(contains('ACCESS_NOTIFICATION_POLICY')));
      expect(main + sound, isNot(contains('setBypassDnd')));
    });
  });
}
