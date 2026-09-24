import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Tab Aktivitas sebelumnya selalu kosong. Kini memuat pembelian PPOB,
/// perjalanan, dan mutasi saldo yang aman untuk Play, terbaru di atas.
Map<String, dynamic> ppobOrder(String id, String status, String at) => {
      'id': id,
      'status': status,
      'sku': 'TSEL-10',
      'productName': 'Telkomsel 10.000',
      'categoryCode': 'PULSA',
      'targetNumber': '081234567890',
      'amount': '10500.00',
      'benefitAmount': '0.00',
      'balanceAmount': '10500.00',
      'createdAt': at,
    };

Map<String, dynamic> ride(String status, String at) => {
      'reference': 'RIDE-1',
      'serviceType': 'MOTORCYCLE',
      'status': status,
      'paymentMethod': 'CASH',
      'paymentState': 'PENDING',
      'isFinal': status == 'COMPLETED',
      'pickupAddress': 'Jl. Melati 1',
      'dropoffAddress': 'Stasiun Kota',
      'distanceMeters': 3000,
      'durationSeconds': 600,
      'fare': {'totalFare': 15000},
      'createdAt': at,
    };

Map<String, dynamic> walletTx(String type, String amount, String at) => {
      'id': '$type-$at',
      'type': type,
      'amount': amount,
      'createdAt': at,
    };

void main() {
  group('tapGoBuildActivityItems', () {
    test(
        'menggabungkan tiga sumber, terbaru di atas, dengan tanda dan label benar',
        () {
      final items = tapGoBuildActivityItems(
        ppobOrders: [
          PpobOrder.fromJson(ppobOrder('o1', 'SUCCESS', '2026-09-20T10:00:00Z'))
        ],
        rides: [
          RideOrderView.fromJson(ride('COMPLETED', '2026-09-22T08:00:00Z'))
        ],
        walletTransactions: [
          walletTx('TOPUP', '50000.00', '2026-09-21T09:00:00Z'),
          walletTx('TRANSFER_OUT', '-20000.00', '2026-09-19T09:00:00Z'),
        ],
      );

      expect(items.map((i) => i.title), [
        'Ojek Motor',
        'Top up saldo',
        'Telkomsel 10.000',
        'Transfer keluar',
      ]);
      expect(items[0].amount, '-Rp15.000');
      expect(items[0].description, 'Jl. Melati 1 → Stasiun Kota');
      expect(items[1].amount, '+Rp50.000');
      expect(items[1].category, 'Saldo');
      expect(items[2].amount, '-Rp10.500');
      expect(items[2].status, 'Berhasil');
      expect(items[3].amount, '-Rp20.000');
    });

    test('bonus, komisi, dan pencairan tidak tampil; pembelian tidak dobel',
        () {
      final items = tapGoBuildActivityItems(
        walletTransactions: [
          walletTx('COMMISSION', '1000.00', '2026-09-20T10:00:00Z'),
          walletTx('SPONSOR_BONUS', '1000.00', '2026-09-20T10:00:00Z'),
          walletTx('REGISTRATION_BONUS', '5000.00', '2026-09-20T10:00:00Z'),
          walletTx('WITHDRAWAL', '-50000.00', '2026-09-20T10:00:00Z'),
          walletTx('PPOB_PURCHASE', '-10500.00', '2026-09-20T10:00:00Z'),
          walletTx('PAYMENT', '-15000.00', '2026-09-20T10:00:00Z'),
          walletTx('TRANSFER_IN', '10000.00', '2026-09-20T10:00:00Z'),
        ],
      );
      expect(items.map((i) => i.title), ['Transfer masuk']);
    });

    test(
        'order gagal/dikembalikan dan perjalanan batal tidak menampilkan nominal terpotong',
        () {
      final items = tapGoBuildActivityItems(
        ppobOrders: [
          PpobOrder.fromJson(ppobOrder('o1', 'FAILED', '2026-09-20T10:00:00Z')),
          PpobOrder.fromJson(
              ppobOrder('o2', 'REFUNDED', '2026-09-20T11:00:00Z')),
        ],
        rides: [
          RideOrderView.fromJson(
              ride('CANCELLED_BY_PASSENGER', '2026-09-20T12:00:00Z'))
        ],
      );
      for (final item in items) {
        expect(item.amount, isNull, reason: item.title + item.status);
      }
      expect(items.map((i) => i.status),
          containsAll(['Gagal', 'Dikembalikan', 'Dibatalkan olehmu']));
    });

    test('tanpa tanggal: tetap tampil di urutan terakhir', () {
      final items = tapGoBuildActivityItems(walletTransactions: [
        {'type': 'TOPUP', 'amount': '1000'},
        walletTx('TOPUP', '2000', '2026-09-20T10:00:00Z'),
      ]);
      expect(items.first.amount, '+Rp2.000');
      expect(items.last.date, 'Baru saja');
    });
  });

  group('layar Aktivitas', () {
    setUp(() => tapGoDisablePersistenceForTests = true);
    tearDown(() {
      tapGoSetHttpAdapterForTests(null);
      tapGoDisablePersistenceForTests = false;
    });

    Future<void> openActivity(WidgetTester tester, FakeApi api) async {
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
          child: const MaterialApp(home: Scaffold(body: ActivityScreen())),
        ),
      );
      for (var i = 0; i < 15; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
    }

    testWidgets('memuat dan menampilkan riwayat nyata, filter tab bekerja',
        (tester) async {
      final api = FakeApi({
        'GET /ppob/orders': (_) => FakeReply.ok({
              'items': [ppobOrder('o1', 'SUCCESS', '2026-09-20T10:00:00Z')],
            }),
        'GET /rides': (_) =>
            FakeReply.ok([ride('COMPLETED', '2026-09-22T08:00:00Z')]),
        'GET /wallet/transactions': (_) => FakeReply.ok([
              walletTx('TOPUP', '50000.00', '2026-09-21T09:00:00Z'),
            ]),
      });
      await openActivity(tester, api);

      expect(find.text('Telkomsel 10.000'), findsOneWidget);
      expect(find.text('Ojek Motor'), findsOneWidget);
      expect(find.text('Top up saldo'), findsOneWidget);
      expect(find.text('Belum ada aktivitas'), findsNothing);

      final chip = find.widgetWithText(ChoiceChip, 'Saldo');
      await tester.ensureVisible(chip);
      await tester.tap(chip);
      await tester.pumpAndSettle();
      expect(find.text('Top up saldo'), findsOneWidget);
      expect(find.text('Ojek Motor'), findsNothing);
      expect(find.text('Telkomsel 10.000'), findsNothing);
    });

    testWidgets('satu sumber gagal: sisanya tetap tampil dengan catatan',
        (tester) async {
      final api = FakeApi({
        'GET /ppob/orders': (_) => FakeReply.ok({'items': <Object>[]}),
        'GET /rides': (_) => FakeReply.network(),
        'GET /wallet/transactions': (_) => FakeReply.ok([
              walletTx('TOPUP', '50000.00', '2026-09-21T09:00:00Z'),
            ]),
      });
      await openActivity(tester, api);

      expect(find.text('Top up saldo'), findsOneWidget);
      expect(find.textContaining('Sebagian riwayat belum termuat'),
          findsOneWidget);
    });

    testWidgets('semua sumber gagal: pesan gagal dengan tombol muat ulang',
        (tester) async {
      final api = FakeApi({
        'GET /ppob/orders': (_) => FakeReply.network(),
        'GET /rides': (_) => FakeReply.network(),
        'GET /wallet/transactions': (_) => FakeReply.network(),
      });
      await openActivity(tester, api);

      expect(find.text('Data belum tersedia'), findsOneWidget);
      expect(find.text('Belum ada aktivitas'), findsNothing);
    });

    testWidgets('akun baru tanpa aktivitas: keadaan kosong yang jelas',
        (tester) async {
      final api = FakeApi({
        'GET /ppob/orders': (_) => FakeReply.ok({'items': <Object>[]}),
        'GET /rides': (_) => FakeReply.ok(<Object>[]),
        'GET /wallet/transactions': (_) => FakeReply.ok(<Object>[]),
      });
      await openActivity(tester, api);

      expect(find.text('Belum ada aktivitas'), findsOneWidget);
    });
  });
}
