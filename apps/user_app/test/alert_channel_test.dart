import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Uji HP 6 Okt 2026: bunyi tidak boleh bergantung pada channel `tapgo_default`
/// yang sudah terkunci senyap di HP. Channel BARU `tapgo_alerts_v3`; aplikasi
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

  setUp(tapGoResetPushUiForTests);
  tearDown(tapGoResetPushUiForTests);

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
    final main = read('android/app/src/main/kotlin/com/xavindo/tapgo/MainActivity.kt');
    final sound = read('android/app/src/main/kotlin/com/xavindo/tapgo/AlertSound.kt');
    final manifest = read('android/app/src/main/AndroidManifest.xml');

    test('AlertSound membuat tapgo_alerts_v3 dengan berkas suara aplikasi, getar, dan USAGE_NOTIFICATION', () {
      expect(sound, contains('"tapgo_alerts_v3"'));
      expect(sound, contains('"Peringatan TapGo"'));
      expect(sound, contains('NotificationManager.IMPORTANCE_HIGH'));
      expect(sound, contains('enableVibration(true)'));
      expect(sound, contains('setSound(soundUri(), attributes())'));
      expect(sound, contains('/raw/\$RAW_NAME'));
      expect(sound, contains('AudioAttributes.USAGE_NOTIFICATION'));
      expect(sound, isNot(contains('setSound(null')));
      expect(sound, isNot(contains('setBypassDnd')));
    });

    test('channel dibuat sebelum notifikasi apa pun (onCreate); berkas suara ada', () {
      final onCreate = main.substring(main.indexOf('override fun onCreate'));
      expect(onCreate.indexOf('alertSound.createChannel()'),
          lessThan(onCreate.indexOf('override fun configureFlutterEngine')));
      expect(File('android/app/src/main/res/raw/tapgo_alert.wav').existsSync(), isTrue);
      expect(File('android/app/src/main/res/raw/tapgo_alert.wav').lengthSync(), greaterThan(10000));
      expect(read('android/app/src/main/res/raw/keep.xml'), contains('tools:keep="@raw/tapgo_alert"'));
    });

    test('MethodChannel tapgo.user/alerts: putar, diagnostik, status izin, pengaturan', () {
      expect(main, contains('"tapgo.user/alerts"'));
      expect(main, contains('"playNotificationSound"'));
      expect(main, contains('"soundDiagnostics"'));
      expect(main, contains('"areNotificationsEnabled"'));
      expect(main, contains('"openNotificationSettings"'));
      expect(sound, contains('MediaPlayer'));
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

  group('uji bunyi: pemeriksaan keadaan HP', () {
    Map<String, Object?> sehat() => {
          'notificationsEnabled': true,
          'soundResourceFound': true,
          'channelExists': true,
          'channelImportance': 4,
          'ringerMode': 2,
          'volumeNotification': 7,
          'volumeNotificationMax': 15,
          'dndFilter': 1,
          'playError': null,
        };

    test('HP sehat: semua hijau', () {
      expect(tapGoSoundChecks(sehat()).every((c) => c.level == TapGoSoundCheckLevel.ok), isTrue);
    });

    test('tiap penghalang menghasilkan pemeriksaan merah dengan tindakan', () {
      bool bad(Map<String, Object?> patch, String contains) =>
          tapGoSoundChecks({...sehat(), ...patch}).any((c) =>
              c.level == TapGoSoundCheckLevel.bad && c.title.contains(contains));
      expect(bad({'notificationsEnabled': false}, 'Notifikasi dimatikan'), isTrue);
      expect(bad({'ringerMode': 0}, 'mode senyap'), isTrue);
      expect(bad({'volumeNotification': 0}, 'Volume notifikasi nol'), isTrue);
      expect(bad({'dndFilter': 3}, 'Jangan Ganggu'), isTrue);
      expect(bad({'channelImportance': 2}, 'tidak berstatus Penting'), isTrue);
      expect(bad({'channelExists': false}, 'belum dibuat'), isTrue);
      expect(bad({'soundResourceFound': false}, 'Berkas suara'), isTrue);
      expect(bad({'playError': 'MediaPlayer error'}, 'gagal diputar'), isTrue);
    });

    test('laporan teks memuat nilai untuk dikirim ke tim', () {
      expect(tapGoSoundReportText(sehat()), contains('ringerMode: 2'));
    });

    testWidgets('layar Uji bunyi: HP sehat hijau; volume nol merah dengan saran', (tester) async {
      tapGoSoundDiagnosticsForTests = () async => sehat();
      addTearDown(() => tapGoSoundDiagnosticsForTests = null);
      await tester.pumpWidget(const MaterialApp(home: TapGoSoundTestScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Pengaturan HP sudah benar.'), findsOneWidget);
      expect(find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key! as ValueKey<String>).value.startsWith('sound-check-bad')), findsNothing);

      tapGoSoundDiagnosticsForTests = () async => {...sehat(), 'volumeNotification': 0};
      await tester.tap(find.byKey(const ValueKey('sound-test-again')));
      await tester.pumpAndSettle();
      expect(find.text('Volume notifikasi nol'), findsOneWidget);
      expect(find.textContaining('Perbaiki yang bertanda merah'), findsOneWidget);
    });

    testWidgets('layar Uji bunyi: native tidak ada = pesan tidak tersedia', (tester) async {
      tapGoSoundDiagnosticsForTests = () async => null;
      addTearDown(() => tapGoSoundDiagnosticsForTests = null);
      await tester.pumpWidget(const MaterialApp(home: TapGoSoundTestScreen()));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('sound-test-unavailable')), findsOneWidget);
    });
  });
}
