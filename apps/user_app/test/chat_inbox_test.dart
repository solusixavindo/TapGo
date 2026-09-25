import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Chat penumpang-driver: kotak masuk di tab Chat, lencana pesan baru, polling
/// (socket nonaktif di produksi), balasan cepat, dan mode baca saja.
Map<String, dynamic> conversation({
  String reference = 'RID-A2B3C4D5E6',
  String status = 'IN_TRIP',
  bool canSend = true,
  int unread = 2,
  String? text = 'Saya sudah di depan',
  String senderType = 'DRIVER',
}) =>
    {
      'rideReference': reference,
      'status': status,
      'serviceType': 'MOTORCYCLE',
      'counterpart': 'DRIVER',
      'canSend': canSend,
      'unreadCount': unread,
      'lastMessage': text == null
          ? null
          : {
              'text': text,
              'senderType': senderType,
              'createdAt': DateTime.now().toUtc().toIso8601String(),
            },
    };

Map<String, dynamic> msg(String id, String text, String sender) => {
      'id': id,
      'message': text,
      'senderType': sender,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    };

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  Future<void> pumpApp(WidgetTester tester, Widget home) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tapGoSessionProviderForTest.overrideWith(
            (ref) => DemoClientSession.initial().copyWith(
              accessToken: 'token-uji',
              isDemoMode: false,
            ),
          ),
        ],
        child: MaterialApp(
          theme: tapGoReadableTheme(),
          home: home,
        ),
      ),
    );
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  group('tab Chat (kotak masuk)', () {
    testWidgets(
        'menampilkan percakapan driver dengan pratinjau dan lencana belum dibaca',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/conversations': (_) => FakeReply.ok([conversation()]),
        'GET /support/tickets': (_) => FakeReply.ok([]),
      }));
      await pumpApp(tester, const Scaffold(body: ChatScreen()));

      expect(find.text('Perjalanan'), findsOneWidget);
      expect(find.text('Driver Anda'), findsOneWidget);
      expect(find.text('Saya sudah di depan'), findsOneWidget);
      expect(find.byKey(const ValueKey('chat_unread_badge')), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      // Bagian bantuan tetap ada di bawahnya.
      expect(find.text('Bantuan TapGo'), findsOneWidget);
    });

    testWidgets(
        'pesan terakhir dari saya diberi awalan "Anda:" dan tanpa lencana',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/conversations': (_) => FakeReply.ok([
              conversation(unread: 0, text: 'Terima kasih', senderType: 'USER'),
            ]),
        'GET /support/tickets': (_) => FakeReply.ok([]),
      }));
      await pumpApp(tester, const Scaffold(body: ChatScreen()));
      expect(find.text('Anda: Terima kasih'), findsOneWidget);
      expect(find.byKey(const ValueKey('chat_unread_badge')), findsNothing);
    });

    testWidgets(
        'perjalanan selesai tampil sebagai "Perjalanan selesai" dengan ikon kunci bila tertutup',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/conversations': (_) => FakeReply.ok([
              conversation(status: 'COMPLETED', canSend: false, unread: 0),
            ]),
        'GET /support/tickets': (_) => FakeReply.ok([]),
      }));
      await pumpApp(tester, const Scaffold(body: ChatScreen()));
      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
    });

    testWidgets('tanpa percakapan: bagian Perjalanan tidak tampil',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/conversations': (_) => FakeReply.ok([]),
        'GET /support/tickets': (_) => FakeReply.ok([]),
      }));
      await pumpApp(tester, const Scaffold(body: ChatScreen()));
      expect(find.text('Perjalanan'), findsNothing);
      expect(find.text('Bantuan TapGo'), findsOneWidget);
    });

    testWidgets(
        'kotak masuk gagal dimuat tidak merusak tab (bantuan tetap tampil)',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/conversations': (_) => FakeReply(500, {'success': false}),
        'GET /support/tickets': (_) => FakeReply.ok([]),
      }));
      await pumpApp(tester, const Scaffold(body: ChatScreen()));
      expect(find.text('Bantuan TapGo'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  test('tapGoChatTimeLabel', () {
    final now = DateTime(2026, 9, 25, 12, 0);
    expect(
        tapGoChatTimeLabel(now.subtract(const Duration(seconds: 20)), now: now),
        'Baru saja');
    expect(
        tapGoChatTimeLabel(now.subtract(const Duration(minutes: 7)), now: now),
        '7 mnt lalu');
    expect(tapGoChatTimeLabel(now.subtract(const Duration(days: 2)), now: now),
        '2 hari lalu');
    expect(tapGoChatTimeLabel(null), '');
  });

  group('layar chat', () {
    testWidgets('polling memasukkan pesan baru dari driver tanpa duplikasi',
        (tester) async {
      var driverReplied = false;
      final api = FakeApi({
        'GET /chat/rides/RID-A2B3C4D5E6/messages': (_) {
          return FakeReply.ok([
            msg('m1', 'Halo, saya menuju lokasi', 'DRIVER'),
            if (driverReplied) msg('m2', 'Saya sudah di depan', 'DRIVER'),
          ]);
        },
        'POST /chat/rides/RID-A2B3C4D5E6/read': (_) =>
            FakeReply.ok({'updated': 0}),
      });
      tapGoSetHttpAdapterForTests(api);
      await pumpApp(
        tester,
        const RideChatScreen(
          rideReference: 'RID-A2B3C4D5E6',
          pollInterval: Duration(milliseconds: 300),
        ),
      );
      expect(find.text('Halo, saya menuju lokasi'), findsOneWidget);
      expect(find.text('Saya sudah di depan'), findsNothing);

      driverReplied = true;
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.text('Saya sudah di depan'), findsOneWidget);
      // Pesan lama tidak dobel walau polling mengembalikannya lagi.
      expect(find.text('Halo, saya menuju lokasi'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'balasan cepat mengirim satu ketukan lewat REST dan tampil sekali',
        (tester) async {
      final api = FakeApi({
        'GET /chat/rides/RID-A2B3C4D5E6/messages': (_) => FakeReply.ok([]),
        'POST /chat/rides/RID-A2B3C4D5E6/read': (_) =>
            FakeReply.ok({'updated': 0}),
        'POST /chat/rides/RID-A2B3C4D5E6/messages': (call) => FakeReply.ok(
              msg('m9', (call.body as Map)['message'] as String, 'USER'),
            ),
      });
      tapGoSetHttpAdapterForTests(api);
      await pumpApp(
        tester,
        const RideChatScreen(rideReference: 'RID-A2B3C4D5E6'),
      );
      await tester.tap(find.byKey(const ValueKey('quick_reply_0')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.text('Saya sudah di titik jemput'),
          findsNWidgets(2)); // chip + gelembung
      expect(api.callsTo('POST /chat/rides/RID-A2B3C4D5E6/messages'),
          hasLength(1));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'canSend=false: mode baca saja tanpa kolom tulis dan balasan cepat',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/rides/RID-A2B3C4D5E6/messages': (_) =>
            FakeReply.ok([msg('m1', 'Terima kasih', 'DRIVER')]),
        'POST /chat/rides/RID-A2B3C4D5E6/read': (_) =>
            FakeReply.ok({'updated': 0}),
      }));
      await pumpApp(
        tester,
        const RideChatScreen(rideReference: 'RID-A2B3C4D5E6', canSend: false),
      );
      expect(
          find.byKey(const ValueKey('chat_read_only_banner')), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
      expect(find.byKey(const ValueKey('quick_reply_0')), findsNothing);
      expect(find.text('Terima kasih'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'server menjawab CHAT_RIDE_NOT_ACTIVE: layar berubah menjadi baca saja',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/rides/RID-A2B3C4D5E6/messages': (_) => FakeReply.ok([]),
        'POST /chat/rides/RID-A2B3C4D5E6/read': (_) =>
            FakeReply.ok({'updated': 0}),
        'POST /chat/rides/RID-A2B3C4D5E6/messages': (_) =>
            FakeReply(409, {'success': false, 'code': 'CHAT_RIDE_NOT_ACTIVE'}),
      }));
      await pumpApp(
        tester,
        const RideChatScreen(rideReference: 'RID-A2B3C4D5E6'),
      );
      await tester.tap(find.byKey(const ValueKey('quick_reply_0')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(
          find.byKey(const ValueKey('chat_read_only_banner')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'tema gelap: gelembung lawan bicara memakai warna permukaan, bukan putih',
        (tester) async {
      tapGoSetHttpAdapterForTests(FakeApi({
        'GET /chat/rides/RID-A2B3C4D5E6/messages': (_) =>
            FakeReply.ok([msg('m1', 'Halo dari driver', 'DRIVER')]),
        'POST /chat/rides/RID-A2B3C4D5E6/read': (_) =>
            FakeReply.ok({'updated': 0}),
      }));
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tapGoSessionProviderForTest.overrideWith(
              (ref) => DemoClientSession.initial().copyWith(
                accessToken: 'token-uji',
                isDemoMode: false,
              ),
            ),
          ],
          child: MaterialApp(
            theme: tapGoReadableTheme(brightness: Brightness.dark),
            home: const RideChatScreen(rideReference: 'RID-A2B3C4D5E6'),
          ),
        ),
      );
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      final bubble = tester.widget<Container>(find
          .ancestor(
              of: find.text('Halo dari driver'),
              matching: find.byType(Container))
          .first);
      expect((bubble.decoration! as BoxDecoration).color, isNot(Colors.white));
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('pintasan chat di Beranda', () {
    Future<FakeApi> pumpHome(
      WidgetTester tester,
      List<Map<String, dynamic>> conversations, {
      Brightness brightness = Brightness.light,
    }) async {
      final api = FakeApi({
        'GET /chat/conversations': (_) => FakeReply.ok(conversations),
        'GET /support/tickets': (_) => FakeReply.ok([]),
        'POST /chat/rides/RID-A2B3C4D5E6/messages': (call) => FakeReply.ok(
              msg('m9', (call.body as Map)['message'] as String, 'USER'),
            ),
        'POST /chat/rides/RID-A2B3C4D5E6/read': (_) =>
            FakeReply.ok({'updated': 1}),
      });
      tapGoSetHttpAdapterForTests(api);
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tapGoSessionProviderForTest.overrideWith(
              (ref) => DemoClientSession.initial().copyWith(
                accessToken: 'token-uji',
                isDemoMode: false,
              ),
            ),
          ],
          child: MaterialApp(
            theme: tapGoReadableTheme(brightness: brightness),
            home: const TapGoDashboard(),
          ),
        ),
      );
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      return api;
    }

    testWidgets('A. tanpa perjalanan berjalan: tidak ada pintasan',
        (tester) async {
      await pumpHome(tester, []);
      expect(find.byKey(const ValueKey('chat_shortcut_strip')), findsNothing);
      expect(find.byKey(const ValueKey('chat_shortcut_card')), findsNothing);
    });

    testWidgets('A. hanya perjalanan selesai/tertutup: tidak ada pintasan',
        (tester) async {
      await pumpHome(tester, [
        conversation(status: 'COMPLETED', canSend: false, unread: 0),
      ]);
      expect(find.byKey(const ValueKey('chat_shortcut_strip')), findsNothing);
      expect(find.byKey(const ValueKey('chat_shortcut_card')), findsNothing);
    });

    testWidgets('B. perjalanan berjalan tanpa pesan baru: strip tipis',
        (tester) async {
      await pumpHome(tester, [conversation(unread: 0, text: null)]);
      expect(find.byKey(const ValueKey('chat_shortcut_strip')), findsOneWidget);
      expect(find.text('Chat dengan driver'), findsOneWidget);
      expect(find.byKey(const ValueKey('chat_shortcut_card')), findsNothing);
      expect(find.byKey(const ValueKey('chat_shortcut_badge')), findsNothing);
    });

    testWidgets(
        'C. pesan baru dari driver: kartu dengan lencana, cuplikan, dan chip',
        (tester) async {
      await pumpHome(tester, [conversation()]);
      expect(find.byKey(const ValueKey('chat_shortcut_card')), findsOneWidget);
      expect(find.byKey(const ValueKey('chat_shortcut_badge')), findsOneWidget);
      expect(find.text('Saya sudah di depan'), findsOneWidget);
      expect(
          find.byKey(const ValueKey('chat_shortcut_chip_0')), findsOneWidget);
      expect(
          find.byKey(const ValueKey('chat_shortcut_chip_1')), findsOneWidget);
    });

    testWidgets('C. mengetuk chip mengirim balasan sekali tanpa membuka chat',
        (tester) async {
      final api = await pumpHome(tester, [conversation()]);
      await tester.tap(find.byKey(const ValueKey('chat_shortcut_chip_0')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      final sends = api.callsTo('POST /chat/rides/RID-A2B3C4D5E6/messages');
      expect(sends, hasLength(1));
      expect((sends.single.body as Map)['message'], tapGoQuickReplies[0]);
      expect(find.text('Chat Perjalanan'), findsNothing);
    });

    testWidgets('C. mengetuk kartu membuka layar chat', (tester) async {
      final api = await pumpHome(tester, [conversation()]);
      api.calls.clear();
      await tester.tap(find.text('Driver Anda'));
      for (var i = 0; i < 15; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.text('Chat Perjalanan'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'tema gelap: kartu memakai warna permukaan tema dan tanpa galat',
        (tester) async {
      await pumpHome(tester, [conversation()], brightness: Brightness.dark);
      expect(find.byKey(const ValueKey('chat_shortcut_card')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
