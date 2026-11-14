import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Rincian Saldo TapGo dibaca dari jawaban server (`/wallet`: breakdown dan lockPercent), bukan disuntik ke sesi.
Map<String, dynamic> authReply() => {
      'user': {
        'id': 'user-1',
        'role': 'USER',
        'status': 'ACTIVE',
        'fullName': 'Pengguna Uji',
        'email': null,
        'phone': '081234567890',
        'referralCode': 'UJI123456',
      },
      'accessToken': 'access-uji',
      'refreshToken': 'refresh-uji',
    };

Map<String, FakeReply Function(FakeCall)> routes(Map<String, dynamic> wallet) => {
      'GET /membership/me': (_) => FakeReply.ok({
            'membership': {
              'membership': {'tier': 'BASIC', 'name': 'Basic'},
            },
          }),
      'GET /wallet': (_) => FakeReply.ok(wallet),
      'GET /wallet/transactions': (_) => FakeReply.ok(<Object>[]),
      'POST /auth/login': (_) => FakeReply.ok(authReply()),
    };

Future<void> loginAndOpenWallet(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 5200));
  await tester.pumpAndSettle();
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), '081234567890');
  await tester.enterText(fields.at(1), 'rahasia-uji-123');
  await tester.tap(find.text('Login').last);
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.tap(find.text('Klik untuk riwayat').first);
  for (var i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets('server mengirim rincian: layar saldo menampilkannya dari jawaban /wallet', (tester) async {
    tapGoSetHttpAdapterForTests(FakeApi(routes({
      'balance': '128000.00',
      'cashBalance': '60000.00',
      'ppobBalance': '5000.00',
      'lockedBonusBalance': '20000.00',
      'depositBalance': '25000.00',
      'breakdown': {'withdrawable': '60000', 'lockedBonus': '20000', 'deposit': '25000', 'other': '23000'},
      'depositWithdrawal': {'enabled': true, 'fee': 2000, 'minimum': 50000, 'holdHours': 24, 'availableAt': null},
      'lockPercent': 20,
    })));
    await loginAndOpenWallet(tester);
    final card = find.byKey(const ValueKey('wallet-breakdown'));
    expect(card, findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('Rp20.000')), findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('Rp25.000')), findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('Rp60.000')), findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('Rp23.000')), findsOneWidget);
  });

  testWidgets('server lama (tanpa rincian): tampilan lama, tanpa kartu rincian', (tester) async {
    tapGoSetHttpAdapterForTests(FakeApi(routes({'balance': '128000.00', 'cashBalance': '60000.00', 'ppobBalance': '5000.00'})));
    await loginAndOpenWallet(tester);
    expect(find.byKey(const ValueKey('wallet-breakdown')), findsNothing);
    expect(find.text('Rp128.000'), findsWidgets);
  });
}
