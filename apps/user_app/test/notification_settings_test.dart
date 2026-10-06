import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Menu Akun > Notifikasi (permintaan Owner, 6 Okt 2026): menggantikan "Uji
/// bunyi". Tiga pilihan bunyi seperti di aplikasi driver (TapGo, Lonceng,
/// Panggilan); mengetuk satu pilihan memilihnya sekaligus membunyikannya, dan
/// pilihan dikirim ke server untuk notifikasi saat aplikasi tertutup.

class _Platform extends FirebasePushPlatform {
  _Platform() : super(isForeground: () => true, playRingtone: (_) async => true);

  @override
  Future<String?> obtainToken() async => 'tok-1';
  @override
  Stream<String> get tokenRefreshes => const Stream.empty();
  @override
  Stream<TapGoPushMessage> get foregroundMessages => const Stream.empty();
  @override
  Stream<TapGoPushMessage> get openedMessages => const Stream.empty();
  @override
  Future<TapGoPushMessage?> initialMessage() async => null;
  @override
  Future<void> deleteToken() async {}
}

String read(String path) => File(path).readAsStringSync();

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final played = <Object?>[];
  var notificationsEnabled = true;
  var settingsOpened = 0;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    tapGoResetAlertToneForTests();
    played.clear();
    notificationsEnabled = true;
    settingsOpened = 0;
    TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(tapGoAlertsMethodChannel, (call) async {
      switch (call.method) {
        case 'playNotificationSound':
          played.add((call.arguments as Map)['sound']);
          return true;
        case 'areNotificationsEnabled':
          return notificationsEnabled;
        case 'openNotificationSettings':
          settingsOpened++;
          return true;
      }
      return null;
    });
  });
  tearDown(() {
    TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(tapGoAlertsMethodChannel, null);
    tapGoResetAlertToneForTests();
  });

  Future<void> openScreen(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: NotificationSettingsScreen()));
    await tester.pumpAndSettle();
  }

  bool isSelected(WidgetTester tester, TapGoAlertTone tone) {
    final tile = find.byKey(ValueKey('tone-${tone.key}'));
    return find
        .descendant(of: tile, matching: find.byIcon(Icons.radio_button_checked_rounded))
        .evaluate()
        .isNotEmpty;
  }

  group('layar Notifikasi', () {
    testWidgets('judul Notifikasi dan tepat tiga pilihan; TapGo terpilih bawaan', (tester) async {
      await openScreen(tester);
      expect(find.text('Notifikasi'), findsWidgets);
      for (final tone in TapGoAlertTone.values) {
        expect(find.byKey(ValueKey('tone-${tone.key}')), findsOneWidget);
        expect(find.text(tone.label), findsOneWidget);
      }
      expect(isSelected(tester, TapGoAlertTone.tapgo), isTrue);
      expect(isSelected(tester, TapGoAlertTone.lonceng), isFalse);
      expect(isSelected(tester, TapGoAlertTone.panggilan), isFalse);
      // Tidak ada sisa layar diagnostik.
      expect(find.textContaining('Uji bunyi'), findsNothing);
    });

    testWidgets('mengetuk pilihan: membunyikan, memilih, dan menyimpan', (tester) async {
      await openScreen(tester);
      for (final tone in [TapGoAlertTone.lonceng, TapGoAlertTone.panggilan, TapGoAlertTone.tapgo]) {
        await tester.tap(find.byKey(ValueKey('tone-${tone.key}')));
        await tester.pumpAndSettle();
        expect(played.last, tone.key);
        expect(isSelected(tester, tone), isTrue);
        expect(tapGoAlertTone.value, tone);
        expect((await SharedPreferences.getInstance()).getString('tapgo_user_alert_tone'), tone.key);
        for (final other in TapGoAlertTone.values.where((t) => t != tone)) {
          expect(isSelected(tester, other), isFalse);
        }
      }
      expect(played, ['lonceng', 'panggilan', 'tapgo']);
    });

    testWidgets('pilihan tersimpan dipulihkan saat layar dibuka kembali', (tester) async {
      SharedPreferences.setMockInitialValues({'tapgo_user_alert_tone': 'panggilan'});
      tapGoResetAlertToneForTests();
      await openScreen(tester);
      expect(isSelected(tester, TapGoAlertTone.panggilan), isTrue);
      expect(tapGoAlertTone.value, TapGoAlertTone.panggilan);
    });

    testWidgets('kunci tersimpan yang rusak jatuh ke TapGo', (tester) async {
      SharedPreferences.setMockInitialValues({'tapgo_user_alert_tone': '../../x'});
      tapGoResetAlertToneForTests();
      await openScreen(tester);
      expect(isSelected(tester, TapGoAlertTone.tapgo), isTrue);
    });

    testWidgets('notifikasi dimatikan di HP: peringatan dengan tombol pengaturan; menyala: tanpa peringatan', (tester) async {
      notificationsEnabled = false;
      await openScreen(tester);
      expect(find.byKey(const ValueKey('notifications-off-notice')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('notifications-open-settings')));
      await tester.pump();
      expect(settingsOpened, 1);

      // Layar dibuka ulang (state baru) setelah notifikasi dinyalakan.
      await tester.pumpWidget(const SizedBox.shrink());
      notificationsEnabled = true;
      await openScreen(tester);
      expect(find.byKey(const ValueKey('notifications-off-notice')), findsNothing);
    });

    for (final brightness in [Brightness.light, Brightness.dark]) {
      testWidgets('dirender tanpa galat di tema ${brightness.name}', (tester) async {
        notificationsEnabled = false;
        await tester.pumpWidget(MaterialApp(
          theme: ThemeData(brightness: brightness, useMaterial3: true),
          home: const NotificationSettingsScreen(),
        ));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byKey(const ValueKey('tone-lonceng')), findsOneWidget);
      });
    }
  });

  group('pilihan dikirim ke server', () {
    tearDown(() async {
      await tapGoStopPush();
      tapGoSetHttpAdapterForTests(null);
      tapGoPushPlatformForTests = null;
    });

    test('pendaftaran token membawa bunyi pilihan, dan didaftarkan ulang saat berganti', () async {
      SharedPreferences.setMockInitialValues({'tapgo_user_alert_tone': 'lonceng'});
      tapGoResetAlertToneForTests();
      final api = FakeApi({
        'POST /notifications/push-token': (_) => FakeReply(200, {'success': true, 'data': {}}),
        'DELETE /notifications/push-token': (_) => FakeReply(200, {'success': true, 'data': {}}),
      });
      tapGoSetHttpAdapterForTests(api);
      tapGoPushPlatformForTests = _Platform();

      tapGoStartPush();
      // start() meminta token lalu mendaftar; beri waktu antrean async.
      for (var i = 0; i < 50 && api.callsTo('POST /notifications/push-token').isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
      final first = api.callsTo('POST /notifications/push-token').single;
      expect((first.body as Map)['sound'], 'lonceng', reason: 'bunyi tersimpan terbaca sebelum mendaftar');
      expect((first.body as Map)['token'], 'tok-1');

      // Token baru tercatat di pengendali setelah pendaftaran pertama selesai.
      await Future<void>.delayed(const Duration(milliseconds: 100));
      await tapGoSelectAlertTone(TapGoAlertTone.panggilan);
      await tapGoReregisterPush();
      final calls = api.callsTo('POST /notifications/push-token').toList();
      expect(calls, hasLength(2));
      expect((calls.last.body as Map)['sound'], 'panggilan');
      expect((calls.last.body as Map)['token'], 'tok-1');
    });
  });

  group('menu Akun', () {
    final dashboard = read('lib/screens/dashboard_screen.dart');

    test('"Uji bunyi" diganti "Notifikasi" yang membuka layar pilihan bunyi', () {
      expect(dashboard, isNot(contains("'Uji bunyi'")));
      expect(dashboard, isNot(contains('TapGoSoundTestScreen')));
      expect(dashboard, contains("'Notifikasi',\n              Icons.notifications_rounded"));
      expect(dashboard, contains('const NotificationSettingsScreen()'));
    });

    test('ikon memakai stiker 1024 px seperti menu lain', () async {
      expect(tapGoPremiumIconAssetForTests('Notifikasi'),
          'assets/icons/basic_portal/notifications.png');
      final file = File('assets/icons/basic_portal/notifications.png');
      expect(file.existsSync(), isTrue);
      final bytes = file.readAsBytesSync();
      expect(String.fromCharCodes(bytes.sublist(1, 4)), 'PNG');
      final header = ByteData.sublistView(Uint8List.fromList(bytes));
      expect(header.getUint32(16, Endian.big), 1024);
      expect(header.getUint32(20, Endian.big), 1024);
      expect(header.getUint8(25), 6, reason: 'RGBA seperti stiker lain');
    });

    test('kode diagnostik lama sudah dihapus', () {
      expect(File('lib/services/sound_diagnostics.dart').existsSync(), isFalse);
      expect(read('lib/main.dart'), isNot(contains('sound_diagnostics')));
    });
  });
}
