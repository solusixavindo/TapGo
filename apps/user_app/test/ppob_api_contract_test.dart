import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/widgets/ppob_shared.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Jalur uang PPOB dari sisi klien nyata terhadap server palsu: bentuk
/// permintaan (SKU, nomor tujuan, idempotency key), pembacaan uang yang dikirim
/// server sebagai string desimal, dan pemetaan error.
const product = {
  'id': 'p1',
  'sku': 'TSEL-10',
  'name': 'Telkomsel 10.000',
  'price': '10000.00',
  'adminFee': '500.00',
  'targetLabel': 'Nomor HP',
};

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  test('katalog dibaca, uang string desimal menjadi angka', () async {
    final api = FakeApi({
      'GET /ppob/catalog': (_) => FakeReply.ok({
            'items': [
              {
                'id': 'c1',
                'code': 'PULSA',
                'name': 'Pulsa',
                'products': [product]
              },
            ],
          }),
    });
    tapGoSetHttpAdapterForTests(api);
    final catalog = await tapGoBuildPpobRepositoryForTests().fetchCatalog();

    expect(catalog.single.code, 'PULSA');
    final p = catalog.single.products.single;
    expect(p.sku, 'TSEL-10');
    expect(p.price, 10000);
    expect(p.totalPrice, 10500);
  });

  test('inquiry mengirim SKU dan nomor tujuan; rincian bayar terbaca',
      () async {
    final api = FakeApi({
      'POST /ppob/orders/inquiry': (_) => FakeReply.ok({
            'product': product,
            'targetNumber': '081234567890',
            'payment': {
              'amount': '10500.00',
              'benefitAmount': '0.00',
              'balanceAmount': '10500.00',
              'sufficient': true,
            },
            'wallet': {'balance': '50000.00', 'ppobBalance': '0.00'},
          }),
    });
    tapGoSetHttpAdapterForTests(api);
    final result = await tapGoBuildPpobRepositoryForTests()
        .inquiry(sku: 'TSEL-10', targetNumber: '081234567890');

    expect(api.callsTo('POST /ppob/orders/inquiry').single.json,
        {'sku': 'TSEL-10', 'targetNumber': '081234567890'});
    expect(result.payment.amount, 10500);
    expect(result.payment.sufficient, isTrue);
    expect(result.walletBalance, 50000);
  });

  test('order membawa idempotency key apa adanya; replay dikenali', () async {
    final api = FakeApi({
      'POST /ppob/orders': (_) => FakeReply.ok({
            'id': 'o1',
            'status': 'SUCCESS',
            'sku': 'TSEL-10',
            'productName': 'Telkomsel 10.000',
            'categoryCode': 'PULSA',
            'targetNumber': '081234567890',
            'amount': '10500.00',
            'benefitAmount': '0.00',
            'balanceAmount': '10500.00',
            'replayed': true,
          }),
    });
    tapGoSetHttpAdapterForTests(api);
    final order = await tapGoBuildPpobRepositoryForTests().createOrder(
      sku: 'TSEL-10',
      targetNumber: '081234567890',
      idempotencyKey: 'kunci-idempoten-1',
    );

    expect(api.callsTo('POST /ppob/orders').single.json['idempotencyKey'],
        'kunci-idempoten-1');
    expect(order.replayed, isTrue);
    expect(order.amount, 10500);
  });

  test(
      'error server dinormalisasi: kode stabil dipertahankan, pesan umum tidak dipakai',
      () async {
    final api = FakeApi({
      'POST /ppob/orders': (_) =>
          FakeReply.error(402, 'INSUFFICIENT_BALANCE', 'Insufficient balance'),
    });
    tapGoSetHttpAdapterForTests(api);
    Object? caught;
    try {
      await tapGoBuildPpobRepositoryForTests()
          .createOrder(sku: 'x', targetNumber: '0812', idempotencyKey: 'k');
    } catch (e) {
      caught = e;
    }
    expect(caught, isA<PpobApiException>());
    expect((caught as PpobApiException).code, 'INSUFFICIENT_BALANCE');
    expect(ppobErrorMessage(caught),
        'Saldo Anda tidak cukup. Silakan gunakan nominal lain.');
  });

  test('jaringan putus menjadi NETWORK_ERROR dengan pesan Indonesia', () async {
    tapGoSetHttpAdapterForTests(
        FakeApi({'GET /ppob/catalog': (_) => FakeReply.network()}));
    Object? caught;
    try {
      await tapGoBuildPpobRepositoryForTests().fetchCatalog();
    } catch (e) {
      caught = e;
    }
    expect((caught as PpobApiException).code, 'NETWORK_ERROR');
    expect(ppobErrorMessage(caught), 'Koneksi ke server gagal.');
  });
}
