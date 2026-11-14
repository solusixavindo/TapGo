import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Layar saldo: kartu saldo di Beranda kini benar-benar menampilkan riwayat.
Future<void> openWallet(WidgetTester tester, FakeApi api) async {
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
            walletBalance: 125000,
            ppobBalance: 5000,
          ),
        ),
      ],
      child: const MaterialApp(home: WalletScreen()),
    ),
  );
  for (var i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Map<String, dynamic> tx(String type, String amount, String at) =>
    {'id': '$type$at', 'type': type, 'amount': amount, 'createdAt': at};

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  testWidgets('menampilkan saldo, aksi, dan hanya mutasi yang aman untuk Play',
      (tester) async {
    final api = FakeApi({
      'GET /wallet/transactions': (_) => FakeReply.ok([
            tx('TOPUP', '50000.00', '2026-09-21T09:00:00Z'),
            tx('TRANSFER_OUT', '-20000.00', '2026-09-20T09:00:00Z'),
            tx('COMMISSION', '9000.00', '2026-09-19T09:00:00Z'),
            tx('WITHDRAWAL', '-50000.00', '2026-09-18T09:00:00Z'),
          ]),
    });
    await openWallet(tester, api);

    expect(find.text('Rp125.000'), findsOneWidget);
    expect(find.text('Saldo PPOB Rp5.000'), findsOneWidget);
    expect(find.text('Top Up'), findsOneWidget);
    expect(find.text('Transfer'), findsOneWidget);
    expect(find.text('Top up saldo'), findsOneWidget);
    expect(find.text('Transfer keluar'), findsOneWidget);
    expect(find.text('+Rp50.000'), findsOneWidget);
    expect(find.text('-Rp20.000'), findsOneWidget);
    // Komisi dan pencairan tidak ada di aplikasi Play.
    expect(find.textContaining('omisi'), findsNothing);
    expect(find.textContaining('ncair'), findsNothing);
    expect(find.textContaining('ithdraw'), findsNothing);
  });

  group('rincian Saldo TapGo (kunci bonus)', () {
    Future<void> openWithBreakdown(WidgetTester tester, {required int lockPercent}) async {
      tapGoSetHttpAdapterForTests(
          FakeApi({'GET /wallet/transactions': (_) => FakeReply.ok(<Object>[])}));
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
                walletBalance: 128000,
                ppobBalance: 5000,
                earningsBalance: 60000,
                lockedBonusBalance: 20000,
                depositBalance: 25000,
                lockPercent: lockPercent,
              ),
            ),
          ],
          child: const MaterialApp(home: WalletScreen()),
        ),
      );
      for (var i = 0; i < 15; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    testWidgets('fitur menyala: menampilkan bonus terkunci, deposit, dan sisa saldo; hanya informasi',
        (tester) async {
      await openWithBreakdown(tester, lockPercent: 20);
      final card = find.byKey(const ValueKey('wallet-breakdown'));
      expect(card, findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Bonus terkunci')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Rp20.000')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Deposit')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Rp25.000')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Saldo bonus')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Rp60.000')), findsOneWidget);
      // 128.000 - 60.000 - 20.000 - 25.000 = 23.000 saldo lain.
      expect(find.descendant(of: card, matching: find.text('Lainnya')), findsOneWidget);
      expect(find.descendant(of: card, matching: find.text('Rp23.000')), findsOneWidget);
      expect(find.textContaining('20% dari tiap bonus'), findsOneWidget);
      // Aturan Play untuk layar ini: tanpa kata komisi/pencairan/withdraw, tanpa tautan atau tombol di kartu.
      expect(find.descendant(of: card, matching: find.byType(TextButton)), findsNothing);
      expect(find.descendant(of: card, matching: find.byType(OutlinedButton)), findsNothing);
      expect(find.descendant(of: card, matching: find.byType(FilledButton)), findsNothing);
      expect(find.textContaining('omisi'), findsNothing);
      expect(find.textContaining('ncair'), findsNothing);
      expect(find.textContaining('ithdraw'), findsNothing);
      expect(find.textContaining('tapgolion'), findsNothing);
    });

    testWidgets('fitur belum menyala (server lama atau mati): kartu rincian tidak tampil sama sekali',
        (tester) async {
      await openWithBreakdown(tester, lockPercent: 0);
      expect(find.byKey(const ValueKey('wallet-breakdown')), findsNothing);
      expect(find.text('Bonus terkunci'), findsNothing);
      expect(find.text('Rp128.000'), findsOneWidget);
    });
  });

  testWidgets('tombol Transfer membuka layar transfer', (tester) async {
    final api =
        FakeApi({'GET /wallet/transactions': (_) => FakeReply.ok(<Object>[])});
    await openWallet(tester, api);
    await tester.tap(find.text('Transfer'));
    await tester.pumpAndSettle();
    expect(find.byType(WalletTransferScreen), findsOneWidget);
  });

  testWidgets('belum ada mutasi: keadaan kosong yang jelas', (tester) async {
    final api =
        FakeApi({'GET /wallet/transactions': (_) => FakeReply.ok(<Object>[])});
    await openWallet(tester, api);
    expect(find.text('Belum ada mutasi saldo'), findsOneWidget);
  });

  testWidgets('server gagal: pesan dan tombol muat ulang, saldo tetap tampil',
      (tester) async {
    final api =
        FakeApi({'GET /wallet/transactions': (_) => FakeReply.network()});
    await openWallet(tester, api);
    expect(find.text('Riwayat belum tersedia'), findsOneWidget);
    expect(find.text('Rp125.000'), findsOneWidget);
  });
}
