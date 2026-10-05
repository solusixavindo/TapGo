import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// 6 Okt 2026: popup chat hanya bergantung pada push FCM; bila FCM tidak sampai,
/// pesan masuk tanpa tanda apa pun. Kotak masuk chat (GET /chat/conversations)
/// kini menjadi pemicu utama; FCM hanya mempercepat. Tanda menetap: titik merah.

const _ref = 'RID-A2B3C4D5E6';

class _Probe extends FirebasePushPlatform {
  _Probe._(this.ringtone, this.shown)
      : super(
          isForeground: () => true,
          playRingtone: () async {
            ringtone.add(1);
            return true;
          },
          showLocal: (id, title, body, details) async => shown.add(details),
        );
  factory _Probe() => _Probe._(<int>[], <NotificationDetails>[]);
  final List<int> ringtone;
  final List<NotificationDetails> shown;
}

TapGoChatConversation conv(int unread, {String ref = _ref, String status = 'IN_TRIP', bool canSend = true}) =>
    TapGoChatConversation(
      rideReference: ref,
      status: status,
      canSend: canSend,
      unreadCount: unread,
    );

Widget app(Widget home) => ProviderScope(
      child: MaterialApp(
        navigatorKey: tapGoNavigatorKeyForTests,
        scaffoldMessengerKey: tapGoScaffoldMessengerKeyForTests,
        home: home,
      ),
    );

void main() {
  late _Probe probe;
  late DateTime now;

  setUp(() {
    tapGoResetPushUiForTests();
    probe = _Probe();
    tapGoPushPlatformForTests = probe;
    now = DateTime(2026, 10, 6, 12);
    tapGoClockForTests = () => now;
  });
  tearDown(tapGoResetPushUiForTests);

  group('selang pembaruan kotak masuk', () {
    test('cepat (6 dtk) selama ada chat aktif yang dapat dibalas; lambat (30 dtk) selain itu', () {
      expect(tapGoChatInboxDelay([conv(0)]), const Duration(seconds: 6));
      expect(tapGoChatInboxDelay(null), const Duration(seconds: 30));
      expect(tapGoChatInboxDelay(const []), const Duration(seconds: 30));
      expect(tapGoChatInboxDelay([conv(0, status: 'COMPLETED')]), const Duration(seconds: 30));
      expect(tapGoChatInboxDelay([conv(0, canSend: false)]), const Duration(seconds: 30));
    });
  });

  group('peringatan dari kotak masuk (tanpa FCM)', () {
    testWidgets('pembacaan pertama hanya patokan: pesan lama tidak diperingatkan', (tester) async {
      await tester.pumpWidget(app(const Scaffold(body: Text('beranda'))));
      tapGoHandleChatInboxUpdate(null, [conv(3)]);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(probe.ringtone, isEmpty);
    });

    testWidgets('jumlah belum dibaca naik: popup + SATU bunyi, tanpa isi pesan', (tester) async {
      await tester.pumpWidget(app(const Scaffold(body: Text('beranda'))));
      tapGoHandleChatInboxUpdate([conv(0)], [conv(1)]);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
      expect(find.text('Pesan baru dari driver'), findsOneWidget);
      expect(probe.ringtone, hasLength(1));
      expect(probe.shown, isEmpty);
    });

    testWidgets('jumlah tetap atau turun: tidak ada peringatan', (tester) async {
      await tester.pumpWidget(app(const Scaffold(body: Text('beranda'))));
      tapGoHandleChatInboxUpdate([conv(2)], [conv(2)]);
      tapGoHandleChatInboxUpdate([conv(2)], [conv(0)]);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(probe.ringtone, isEmpty);
    });

    testWidgets('layar chat perjalanan itu terbuka: tanpa popup dan tanpa bunyi', (tester) async {
      await tester.pumpWidget(app(const Scaffold(body: Text('beranda'))));
      tapGoOpenChatReference = _ref;
      tapGoHandleChatInboxUpdate([conv(0)], [conv(2)]);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(probe.ringtone, isEmpty);
    });

    testWidgets('push dan kotak masuk untuk pesan yang sama = SATU peringatan; 8 detik kemudian pesan baru berbunyi lagi',
        (tester) async {
      await tester.pumpWidget(app(const Scaffold(body: Text('beranda'))));
      tapGoShowForegroundPushForTests(const TapGoPushMessage(
        title: 'Pesan baru dari driver',
        body: 'Ketuk untuk membaca.',
        data: {'type': 'chat_message', 'rideReference': _ref},
      ));
      tapGoHandleChatInboxUpdate([conv(0)], [conv(1)]);
      await tester.pumpAndSettle();
      expect(probe.ringtone, hasLength(1));
      await tester.tap(find.byKey(const ValueKey('chat-popup-later')));
      await tester.pumpAndSettle();

      now = now.add(const Duration(seconds: 9));
      tapGoHandleChatInboxUpdate([conv(1)], [conv(2)]);
      await tester.pumpAndSettle();
      expect(probe.ringtone, hasLength(2));
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets('perjalanan berbeda diperingatkan masing-masing', (tester) async {
      await tester.pumpWidget(app(const Scaffold(body: Text('beranda'))));
      tapGoHandleChatInboxUpdate(
          [conv(0), conv(0, ref: 'RID-ZZZZZZZZZZ')], [conv(1), conv(1, ref: 'RID-ZZZZZZZZZZ')]);
      await tester.pumpAndSettle();
      expect(probe.ringtone, hasLength(2));
    });
  });

  group('titik merah pada tombol Chat dengan Driver', () {
    Map<String, dynamic> order({String status = 'DRIVER_ASSIGNED'}) => {
          'reference': _ref,
          'serviceType': 'MOTORCYCLE',
          'status': status,
          'isFinal': false,
          'pickupAddress': 'Jl. Melati 1',
          'dropoffAddress': 'Stasiun',
          'distanceMeters': 4200,
          'durationSeconds': 900,
          'fare': {'totalFare': 18500, 'currency': 'IDR'},
          'payment': {'method': 'CASH', 'state': 'PENDING'},
          'driver': {'displayName': 'Budi'},
          'vehicle': {
            'serviceType': 'MOTORCYCLE',
            'model': 'Vario',
            'color': 'Hitam',
            'maskedPlate': 'B 12•• XYZ',
          },
          'createdAt': '2026-10-06T10:05:00Z',
        };

    Map<String, dynamic> inbox(int unread) => {
          'rideReference': _ref,
          'status': 'DRIVER_ASSIGNED',
          'canSend': true,
          'unreadCount': unread,
        };

    Future<void> pump(WidgetTester tester, int unread) async {
      tester.view.physicalSize = const Size(1080, 2800);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      tapGoChatConversationsLoaderForTests = () async => [inbox(unread)];
      await tester.pumpWidget(app(RideStatusScreen(
        reference: _ref,
        autoStart: false,
        initialOrder: RideOrderView.fromJson(order()),
      )));
      await tester.pumpAndSettle();
    }

    testWidgets('pesan belum dibaca: titik merah dengan angka dan teks "(pesan baru)"', (tester) async {
      await pump(tester, 2);
      expect(tester.widget<Badge>(find.byKey(const ValueKey('ride-chat-badge'))).isLabelVisible, isTrue);
      expect(find.text('Chat dengan Driver (pesan baru)'), findsOneWidget);
    });

    testWidgets('semua terbaca: tanpa titik merah', (tester) async {
      await pump(tester, 0);
      expect(tester.widget<Badge>(find.byKey(const ValueKey('ride-chat-badge'))).isLabelVisible, isFalse);
      expect(find.text('Chat dengan Driver'), findsOneWidget);
    });
  });
}
