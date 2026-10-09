import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_providers.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_history_screen.dart';
import 'package:tapgo_user_app/features/ppob/presentation/ppob_receipt_screen.dart';

/// Bukti transaksi untuk SEMUA kategori Digital (prabayar) dan Tagihan (pascabayar).
/// Bentuk JSON sama dengan jawaban backend `/ppob/orders` (diuji di
/// backend `allCategoriesReceipt.integration.test.ts`): setiap kategori harus menampilkan
/// nomor token/referensi, nomor transaksi, dan waktu; tagihan juga nama pelanggan, periode,
/// dan rincian angka. Kasus Juhri (9 Okt 2026): token PLN tidak sampai ke pembeli.

class _Case {
  const _Case(this.category, this.product, this.target, this.serial, this.label,
      this.shownSerial,
      {this.bill = false});
  final String category;
  final String product;
  final String target;
  final String serial;
  final String label; // label nomor yang tampil
  final String
      shownSerial; // teks yang tampil (bagian sebelum "/" dan diformat)
  final bool bill;
}

const _cases = <_Case>[
  _Case('PULSA', 'Pulsa Telkomsel 10.000', '081355503217', '0123456789012345',
      'Nomor referensi', '0123456789012345'),
  _Case('DATA', 'Paket Data 5GB', '081355503217', 'DATA-5GB-7788',
      'Nomor referensi', 'DATA-5GB-7788'),
  _Case(
      'PLN_PREPAID',
      'Token PLN 20.000',
      '561100520563',
      '1061-9332-9912-1453-6226/SAAMAH/R1/450/46,8KWH',
      'Nomor token listrik',
      '1061-9332-9912-1453-6226'),
  _Case('EWALLET', 'DANA 20.000', '083803888668', 'DANA-REF-20261009-001',
      'Nomor referensi', 'DANA-REF-20261009-001'),
  _Case('BPJS', 'BPJS Kesehatan', '8888801234560001', 'BPJS-0001234567',
      'Nomor referensi', 'BPJS-0001234567',
      bill: true),
  _Case('PDAM', 'PDAM Tirta Multatuli Kabupaten Lebak', '1013226',
      'PDAM-2026-10-7788', 'Nomor referensi', 'PDAM-2026-10-7788',
      bill: true),
  _Case('PLN_POSTPAID', 'PLN Pascabayar', '530000000003',
      'PLNPASCA/ABCD1234EFGH5678', 'Nomor referensi', 'PLNPASCA',
      bill: true),
  _Case('BPJS_TK', 'BPJS Ketenagakerjaan Penerima Upah', '12345678901',
      'BPJSTK-2026-5521', 'Nomor referensi', 'BPJSTK-2026-5521',
      bill: true),
  _Case('TELKOM', 'Telkom', '02112345678', 'TELKOM-REF-9911', 'Nomor referensi',
      'TELKOM-REF-9911',
      bill: true),
  _Case('INTERNET', 'IndiHome', '121234567890', 'INDIHOME-REF-4412',
      'Nomor referensi', 'INDIHOME-REF-4412',
      bill: true),
  _Case('TV', 'TV Kabel', '1234567890', 'TV-REF-3301', 'Nomor referensi',
      'TV-REF-3301',
      bill: true),
  _Case('HP_POSTPAID', 'HP Pascabayar', '081355503217', 'HALO-REF-7720',
      'Nomor referensi', 'HALO-REF-7720',
      bill: true),
  _Case('MULTIFINANCE', 'Angsuran BAF', 'A123/456-789', 'BAF-REF-5566',
      'Nomor referensi', 'BAF-REF-5566',
      bill: true),
  _Case('PBB', 'PBB Kabupaten', '329801092375999991', 'PBB-NTPN-8800',
      'Nomor referensi', 'PBB-NTPN-8800',
      bill: true),
  _Case('GAS', 'PGN Gas', '0123456789', 'PGN-REF-1200', 'Nomor referensi',
      'PGN-REF-1200',
      bill: true),
  _Case('EMONEY', 'E-Money', '082100000001', 'EMONEY-REF-3030',
      'Nomor referensi', 'EMONEY-REF-3030',
      bill: true),
];

Map<String, dynamic> _json(_Case c,
        {String status = 'SUCCESS', bool withSerial = true}) =>
    {
      'id':
          'PPB-${c.category.replaceAll('_', '').padRight(6, 'X').substring(0, 6)}1234',
      'status': status,
      'sku': 'SKU_${c.category}',
      'productName': c.product,
      'categoryCode': c.category,
      'targetNumber': c.target,
      'amount': c.bill ? 102350 : 20500,
      'benefitAmount': c.bill ? 102350 : 20500,
      'balanceAmount': 0,
      'failureReason': null,
      'providerRef': 'REF',
      'serialNumber': withSerial ? c.serial : null,
      'bill': c.bill
          ? {
              'customerName': 'BUDI SANTOSO',
              'period': '202610',
              'billAmount': 100000,
              'feeAmount': 2350,
              'totalAmount': 102350
            }
          : null,
      'createdAt': '2026-10-09T09:28:41.051Z',
      'completedAt': '2026-10-09T09:28:43.000Z',
      'refundedAt': null,
      'replayed': false,
    };

Future<void> _open(WidgetTester tester, Widget home) async {
  tester.view.physicalSize = const Size(900, 2200);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: home));
  await tester.pumpAndSettle();
}

void main() {
  for (final c in _cases) {
    testWidgets(
        'bukti transaksi ${c.bill ? 'Tagihan' : 'Digital'} · ${c.category}: nomor referensi/token, nomor transaksi, waktu${c.bill ? ', nama pelanggan, periode, rincian' : ''}',
        (tester) async {
      final order = PpobOrder.fromJson(_json(c));
      await _open(tester, PpobReceiptScreen(order: order));

      expect(find.text('Bukti Transaksi'), findsOneWidget);
      expect(find.text(c.product), findsOneWidget);
      expect(find.text(c.target), findsOneWidget);
      expect(find.text('Berhasil'), findsOneWidget);
      expect(find.text(c.label), findsOneWidget);
      expect(find.text(c.shownSerial), findsOneWidget);
      expect(find.byKey(const ValueKey('ppob-serial-copy')), findsOneWidget);
      expect(find.text('No. Transaksi'), findsOneWidget);
      expect(find.text(order.id), findsOneWidget);
      expect(find.text('Waktu'), findsOneWidget);
      if (c.bill) {
        expect(find.text('Nama pelanggan'), findsOneWidget);
        expect(find.text('BUDI SANTOSO'), findsOneWidget);
        expect(find.text('Periode'), findsOneWidget);
        expect(find.text('Okt 2026'), findsOneWidget);
        expect(find.text('Tagihan'), findsOneWidget);
        expect(find.text('Rp100.000'), findsOneWidget);
        expect(find.text('Biaya admin & layanan'), findsOneWidget);
        expect(find.text('Rp2.350'), findsOneWidget);
      } else {
        expect(find.text('Nama pelanggan'), findsNothing);
      }
    });
  }

  testWidgets(
      'transaksi Diproses: token PLN menampilkan catatan, pulsa tidak mengada-ada',
      (tester) async {
    final pln = _cases.firstWhere((c) => c.category == 'PLN_PREPAID');
    await _open(
        tester,
        PpobReceiptScreen(
            order: PpobOrder.fromJson(
                _json(pln, status: 'PROCESSING', withSerial: false))));
    expect(find.byKey(const ValueKey('ppob-serial-waiting')), findsOneWidget);
    expect(find.text('Diproses'), findsOneWidget);
    expect(find.byKey(const ValueKey('ppob-serial-copy')), findsNothing);
  });

  testWidgets('Riwayat: mengetuk kartu transaksi membuka bukti lengkapnya',
      (tester) async {
    final bpjs = _cases.firstWhere((c) => c.category == 'BPJS');
    final order = PpobOrder.fromJson(_json(bpjs));
    tester.view.physicalSize = const Size(900, 2200);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ppobOrdersProvider.overrideWith((ref) async => [order])
      ],
      child: const MaterialApp(home: PpobHistoryScreen()),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(ValueKey('ppob-order-tile-${order.id}')));
    await tester.pumpAndSettle();

    expect(find.text('Bukti Transaksi'), findsOneWidget);
    expect(find.text('BUDI SANTOSO'), findsOneWidget);
    expect(find.text('BPJS-0001234567'), findsWidgets);
  });

  test(
      'model: bill hanya terbaca bila punya nama pelanggan; angka dan periode dirapikan',
      () {
    final c = _cases.firstWhere((c) => c.category == 'PDAM');
    final json = _json(c);
    expect(PpobOrder.fromJson(json).bill!.billAmount, 100000);
    expect(
        PpobOrder.fromJson({
          ...json,
          'bill': {'customerName': '  '}
        }).bill,
        isNull);
    expect(PpobOrder.fromJson({...json, 'bill': null}).bill, isNull);
    expect(PpobOrder.fromJson({...json, 'bill': 'x'}).bill, isNull);
  });
}
