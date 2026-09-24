import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Kontrak dengan backend SUNGGUHAN: berkas di test/fixtures adalah respons
/// yang ditangkap dari backend lokal (server nyata, database uji), bukan
/// karangan. Bila bentuk respons backend berubah, tes ini yang pertama gagal.
Object fixture(String name) =>
    jsonDecode(File('test/fixtures/$name').readAsStringSync());

Object data(String name) => (fixture(name) as Map)['data'] as Object;

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  test('mutasi saldo nyata: jumlah string dibaca, komisi/pembelian disaring',
      () {
    final rows = (data('backend_wallet_transactions.json') as List)
        .cast<Map<String, dynamic>>();
    expect(rows.map((r) => r['type']),
        containsAll(['TOPUP', 'TRANSFER_OUT', 'COMMISSION', 'PPOB_PURCHASE']));

    final items = tapGoBuildActivityItems(walletTransactions: rows);
    expect(
        items.map((i) => i.title).toSet(), {'Top up saldo', 'Transfer keluar'});
    expect(
        items.firstWhere((i) => i.title == 'Top up saldo').amount, '+Rp50.000');
    expect(items.firstWhere((i) => i.title == 'Transfer keluar').amount,
        '-Rp20.000');
    expect(items.every((i) => i.date != 'Baru saja'), isTrue);
  });

  testWidgets('layar saldo dengan respons backend nyata', (tester) async {
    tapGoSetHttpAdapterForTests(FakeApi({
      'GET /wallet/transactions': (_) =>
          FakeReply(200, fixture('backend_wallet_transactions.json')),
    }));
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tapGoSessionProviderForTest.overrideWith(
            (ref) => DemoClientSession.initial().copyWith(
              accessToken: 't',
              isDemoMode: false,
              walletBalance: 125000,
            ),
          ),
        ],
        child: const MaterialApp(home: WalletScreen()),
      ),
    );
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Top up saldo'), findsWidgets);
    expect(find.text('Transfer keluar'), findsWidgets);
    expect(find.textContaining('omisi'), findsNothing);
    expect(find.textContaining('Pembelian'), findsNothing);
  });

  testWidgets('tab Chat dengan tiket backend nyata', (tester) async {
    final tickets = (data('backend_support_tickets.json') as List)
        .cast<Map<String, dynamic>>();
    tapGoSupportTicketsLoaderForTests = () async => tickets;
    addTearDown(() => tapGoSupportTicketsLoaderForTests = null);
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const ProviderScope(
          child: MaterialApp(home: Scaffold(body: ChatScreen()))),
    );
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('Uji kontrak'), findsOneWidget);
    expect(find.textContaining('TGS-'), findsOneWidget);
    expect(find.textContaining('Terbuka'), findsOneWidget);
  });

  test('daftar perjalanan kosong dan dompet nyata terbaca', () async {
    tapGoSetHttpAdapterForTests(FakeApi({
      'GET /rides': (_) => FakeReply(200, fixture('backend_rides_empty.json')),
    }));
    expect(tapGoBuildActivityItems(), isEmpty);
    final wallet = data('backend_wallet.json') as Map;
    expect(wallet['balance'], '125000');
    expect(wallet.containsKey('ppobBalance'), isTrue);
  });
}
