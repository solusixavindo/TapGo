import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

/// Uji HP 6 Okt 2026: driver +10 tidak berbunyi. Channel `tapgo_default` sudah
/// dibuat oleh APK lama di HP dan suaranya tidak dapat diubah pemasangan baru
/// (Android 8+), jadi peringatan memakai channel BARU `tapgo_alerts_v3` dan,
/// saat aplikasi di depan, berkas suara aplikasi sendiri (tidak bergantung pada
/// notifikasi). Satu peristiwa = satu bunyi. Sejak +14 driver memilih satu dari
/// tiga bunyi (TapGo, Lonceng, Panggilan), masing-masing punya channel sendiri.

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
  DriverAlertTone tone = DriverAlertTone.tapgo,
  List<DriverAlertTone>? playedTones,
}) {
  final sink = playedTones ?? <DriverAlertTone>[];
  return FirebaseDriverPushPlatform(
    isForeground: () => foreground,
    tone: () => tone,
    playRingtone: (played) async {
      ringtoneCalls.add(1);
      sink.add(played);
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
    test('bunyi bawaan TapGo: channel tapgo_alerts_v3, Importance.high, suara dan getar menyala', () {
      final android = driverAlertNotificationDetails().android!;
      expect(android.channelId, 'tapgo_alerts_v3');
      expect(android.channelName, 'Peringatan TapGo');
      expect(android.importance, Importance.high);
      expect(android.priority, Priority.high);
      expect(android.playSound, isTrue);
      expect(android.enableVibration, isTrue);
      // Tanpa sound: null dan tanpa silent: true.
      expect(android.sound, isNull);
      expect(android.silent, isFalse);
    });

    test('tiga bunyi, tiga channel berbeda; semuanya bersuara dan Importance.high', () {
      expect(DriverAlertTone.values.map((t) => t.key), ['tapgo', 'lonceng', 'panggilan']);
      expect(DriverAlertTone.values.map((t) => t.channelId).toSet(), hasLength(3));
      expect(DriverAlertTone.lonceng.channelId, 'tapgo_alerts_v3_lonceng');
      expect(DriverAlertTone.panggilan.channelId, 'tapgo_alerts_v3_panggilan');
      for (final tone in DriverAlertTone.values) {
        final android = driverAlertNotificationDetails(tone).android!;
        expect(android.channelId, tone.channelId);
        expect(android.importance, Importance.high);
        expect(android.playSound, isTrue);
        expect(android.silent, isFalse);
      }
    });

    test('kunci tak dikenal atau kosong jatuh ke bunyi bawaan TapGo', () {
      expect(DriverAlertTone.fromKey('lonceng'), DriverAlertTone.lonceng);
      expect(DriverAlertTone.fromKey('panggilan'), DriverAlertTone.panggilan);
      expect(DriverAlertTone.fromKey(null), DriverAlertTone.tapgo);
      expect(DriverAlertTone.fromKey(''), DriverAlertTone.tapgo);
      expect(DriverAlertTone.fromKey('../../etc'), DriverAlertTone.tapgo);
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
      expect(shown.single.details.android!.channelId, 'tapgo_alerts_v3');
      expect(shown.single.details.android!.channelId, isNot('tapgo_default'));
    });

    test('di belakang: hanya notifikasi channel tapgo_alerts_v3; ringtone tidak disentuh', () async {
      final ringtone = <int>[];
      final shown = <ShownNotification>[];
      final platform = platformWith(
          foreground: false, ringtoneWorks: true, ringtoneCalls: ringtone, shown: shown);
      await platform.showForegroundAlert(msg('chat_message', title: 'Pesan baru dari penumpang'));
      expect(ringtone, isEmpty);
      expect(shown, hasLength(1));
      expect(shown.single.details.android!.channelId, 'tapgo_alerts_v3');
      expect(shown.single.details.android!.playSound, isTrue);
      expect(shown.single.title, 'Pesan baru dari penumpang');
    });

    test('bunyi pilihan dipakai: di depan memutar bunyi itu, di belakang memakai channel-nya', () async {
      for (final tone in DriverAlertTone.values) {
        final played = <DriverAlertTone>[];
        final shownFront = <ShownNotification>[];
        await platformWith(
                foreground: true,
                ringtoneWorks: true,
                ringtoneCalls: <int>[],
                shown: shownFront,
                tone: tone,
                playedTones: played)
            .showForegroundAlert(msg('ride_offer'));
        expect(played, [tone]);
        expect(shownFront, isEmpty);

        final shownBack = <ShownNotification>[];
        await platformWith(
                foreground: false,
                ringtoneWorks: true,
                ringtoneCalls: <int>[],
                shown: shownBack,
                tone: tone)
            .showForegroundAlert(msg('ride_offer'));
        expect(shownBack.single.details.android!.channelId, tone.channelId);
      }
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

    test('memanggil playNotificationSound dengan kunci bunyi pada channel tapgo.driver/alerts', () async {
      final calls = <String>[];
      final sounds = <Object?>[];
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(driverAlertsMethodChannel, (call) async {
        calls.add(call.method);
        sounds.add((call.arguments as Map)['sound']);
        return true;
      });
      expect(await driverPlayNotificationRingtone(), isTrue);
      expect(await driverPlayNotificationRingtone(DriverAlertTone.lonceng), isTrue);
      expect(await driverPlayNotificationRingtone(DriverAlertTone.panggilan), isTrue);
      expect(calls, ['playNotificationSound', 'playNotificationSound', 'playNotificationSound']);
      expect(sounds, ['tapgo', 'lonceng', 'panggilan']);
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

  group('berkas Android: channel baru, suara aplikasi sendiri, tanpa izin terlarang', () {
    final main = read('android/app/src/main/kotlin/com/xavindo/tapgo/driver/MainActivity.kt');
    final sound = read('android/app/src/main/kotlin/com/xavindo/tapgo/driver/AlertSound.kt');
    final manifest = read('android/app/src/main/AndroidManifest.xml');

    test('AlertSound membuat tiga channel (satu per bunyi) dengan berkas suara aplikasi, getar, dan USAGE_NOTIFICATION', () {
      for (final id in ['tapgo_alerts_v3', 'tapgo_alerts_v3_lonceng', 'tapgo_alerts_v3_panggilan']) {
        expect(sound, contains('"$id"'), reason: id);
      }
      for (final raw in ['tapgo_alert', 'tapgo_alert_lonceng', 'tapgo_alert_panggilan']) {
        expect(sound, contains('"$raw"'), reason: raw);
      }
      expect(sound, contains('"Peringatan TapGo"'));
      expect(sound, contains('NotificationManager.IMPORTANCE_HIGH'));
      expect(sound, contains('enableVibration(true)'));
      expect(sound, contains('setSound(soundUri(tone), attributes())'));
      expect(sound, contains('/raw/\${tone.rawName}'));
      expect(sound, contains('AudioAttributes.USAGE_NOTIFICATION'));
      expect(sound, isNot(contains('setSound(null')));
      expect(sound, isNot(contains('setBypassDnd')));
    });

    test('id channel dan kunci bunyi di Kotlin sama dengan enum Dart', () {
      for (final tone in DriverAlertTone.values) {
        expect(sound, contains('"${tone.channelId}"'), reason: tone.channelId);
        expect(sound, contains('("${tone.key}"'), reason: tone.key);
      }
    });

    test('suara dibuat sebelum notifikasi apa pun (onCreate) dan ketiga berkasnya ada', () {
      final onCreate = main.substring(main.indexOf('override fun onCreate'));
      expect(onCreate.indexOf('alertSound.createChannels()'),
          lessThan(onCreate.indexOf('override fun configureFlutterEngine')));
      final keep = read('android/app/src/main/res/raw/keep.xml');
      for (final raw in ['tapgo_alert', 'tapgo_alert_lonceng', 'tapgo_alert_panggilan']) {
        final file = File('android/app/src/main/res/raw/$raw.wav');
        expect(file.existsSync(), isTrue, reason: raw);
        expect(file.lengthSync(), greaterThan(10000), reason: raw);
        expect(keep, contains('@raw/$raw'), reason: raw);
      }
    });

    test('MethodChannel tapgo.driver/alerts: putar bunyi pilihan dan status izin; tanpa layar diagnostik', () {
      expect(main, contains('"tapgo.driver/alerts"'));
      expect(main, contains('"playNotificationSound"'));
      expect(main, contains('call.argument<String>("sound")'));
      expect(main, contains('"areNotificationsEnabled"'));
      expect(main, isNot(contains('soundDiagnostics')));
      expect(sound, contains('MediaPlayer'));
    });

    test('manifest: channel default FCM ikut tapgo_alerts_v3', () {
      expect(manifest,
          contains('com.google.firebase.messaging.default_notification_channel_id'));
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

    test('tidak ada izin RECORD_AUDIO atau USE_FULL_SCREEN_INTENT, tidak mematikan Jangan Ganggu', () {
      // RECORD_AUDIO hanya boleh muncul sebagai penghapusan (tools:node="remove").
      for (final line in manifest.split('\n')) {
        if (line.contains('uses-permission') && line.contains('RECORD_AUDIO')) {
          expect(line, contains('tools:node="remove"'));
        }
      }
      expect(manifest, isNot(contains('USE_FULL_SCREEN_INTENT')));
      expect(manifest, isNot(contains('ACCESS_NOTIFICATION_POLICY')));
      expect(main + sound, isNot(contains('setBypassDnd')));
    });

    test('notifikasi "TapGo Driver aktif" tetap di channel layanan lokasinya sendiri', () {
      final location = read('lib/features/driver/location/driver_location_port.dart');
      expect(location, contains("notificationTitle: 'TapGo Driver aktif'"));
      expect(location, contains("notificationChannelName: 'Status online driver'"));
      expect(location, isNot(contains('tapgo_alerts')));
    });
  });
}
