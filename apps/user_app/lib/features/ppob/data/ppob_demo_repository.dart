import 'ppob_repository.dart';
import '../domain/ppob_models.dart';

/// Repository demo: nol network, melayani katalog mini dan mensimulasikan
/// perilaku fail-closed Stage R2.7 (provider biller belum terhubung, order
/// berakhir REFUNDED). Dipakai build demo/UAT agar alur PPOB dapat diuji
/// tanpa backend — saldo di sini angka demo, bukan milik siapa pun.
///
/// Mengembalikan [PpobRepository] (bukan subclass) supaya satu tipe yang sama
/// dipakai di seluruh provider graph.
PpobRepository createDemoPpobRepository() {
  final state = _PpobDemoState();
  return PpobRepository(
    catalogRequest: () async => state.catalogJson,
    inquiryRequest: ({required sku, required targetNumber}) async =>
        state.inquiry(sku: sku, targetNumber: targetNumber),
    createOrderRequest: ({
      required sku,
      required targetNumber,
      required idempotencyKey,
    }) async =>
        state.createOrder(
      sku: sku,
      targetNumber: targetNumber,
      idempotencyKey: idempotencyKey,
    ),
    ordersRequest: () async => state.ordersJson,
  );
}

/// Akses katalog demo sebagai MODEL (bukan JSON) untuk harness visual/test
/// yang perlu membangun layar dengan produk demo nyata.
abstract final class PpobDemoCatalog {
  static List<PpobCategory> get categories => _PpobDemoState()
      .catalogJson
      .whereType<Map<String, dynamic>>()
      .map(PpobCategory.fromJson)
      .toList();

  static List<PpobProduct> get products =>
      categories.expand((category) => category.products).toList();
}

class _PpobDemoState {
  static const _demoBalance = 250000.0;
  static const _demoPpobBalance = 50000.0;

  final List<Map<String, dynamic>> _orders = [];
  int _sequence = 0;

  List<dynamic> get catalogJson => [
        _category('demo-cat-pulsa', 'PULSA', 'Pulsa', 'phone_iphone', 1, [
          _product('demo-pulsa-10k', 'PULSA_10K', 'Pulsa Rp10.000', 11500.0, 0.0,
              'Nomor HP', '^[0-9]{10,15}\$', 1),
          _product('demo-pulsa-50k', 'PULSA_50K', 'Pulsa Rp50.000', 51000.0, 0.0,
              'Nomor HP', '^[0-9]{10,15}\$', 2),
        ]),
        _category('demo-cat-data', 'DATA', 'Paket Data', 'wifi', 2, [
          _product('demo-data-5gb', 'DATA_5GB', 'Paket Data 5 GB', 43000.0, 0.0,
              'Nomor HP', '^[0-9]{10,15}\$', 1),
        ]),
        _category('demo-cat-pln', 'PLN_TOKEN', 'Token PLN', 'bolt', 3, [
          _product('demo-pln-50k', 'PLN_50K', 'Token PLN Rp50.000', 51500.0, 0.0,
              'ID Pelanggan / Nomor Meter', '^[0-9]{11,12}\$', 1),
        ]),
        _category('demo-cat-bpjs', 'BPJS', 'BPJS', 'health_and_safety', 4, [
          _product('demo-bpjs-1', 'BPJS_IURAN_1BULAN',
              'Iuran BPJS Kesehatan 1 Bulan', 42000.0, 2500.0, 'Nomor VA BPJS',
              '^[0-9]{8,20}\$', 1),
        ]),
        _category('demo-cat-pdam', 'PDAM', 'PDAM', 'water_drop', 5, [
          _product('demo-pdam-50k', 'PDAM_50K', 'Tagihan PDAM Rp50.000', 50000.0,
              3000.0, 'ID Pelanggan PDAM', '^[0-9]{6,20}\$', 1),
        ]),
        _category(
            'demo-cat-emoney', 'EMONEY', 'E-Money', 'account_balance_wallet', 6, [
          _product('demo-emoney-50k', 'EMONEY_50K', 'E-Money Rp50.000', 51500.0,
              0.0, 'Nomor HP / ID Dompet', '^[0-9]{8,16}\$', 1),
        ]),
      ];

  List<dynamic> get ordersJson => List<dynamic>.unmodifiable(_orders.reversed);

  Map<String, dynamic> inquiry({
    required String sku,
    required String targetNumber,
  }) {
    final product = _findProduct(sku);
    if (product == null) {
      throw const PpobApiException(
        code: 'PPOB_PRODUCT_NOT_FOUND',
        message: 'Produk PPOB tidak ditemukan.',
        statusCode: 404,
      );
    }
    final pattern = product['targetPattern'] as String?;
    if (pattern != null && !RegExp(pattern).hasMatch(targetNumber)) {
      throw PpobApiException(
        code: 'PPOB_TARGET_INVALID',
        message: 'Nomor tujuan tidak valid untuk ${product['targetLabel']}.',
        statusCode: 400,
      );
    }
    final price = product['price'] as double;
    final adminFee = product['adminFee'] as double;
    final amount = price + adminFee;
    final benefit = amount < _demoPpobBalance ? amount : _demoPpobBalance;
    return {
      'product': product,
      'targetNumber': targetNumber,
      'price': price,
      'adminFee': adminFee,
      'amount': amount,
      'payment': {
        'amount': amount,
        'benefitAmount': benefit,
        'balanceAmount': amount - benefit,
        'sufficient': _demoBalance >= amount,
      },
      'wallet': {
        'balance': _demoBalance,
        'ppobBalance': _demoPpobBalance,
      },
    };
  }

  Map<String, dynamic> createOrder({
    required String sku,
    required String targetNumber,
    required String idempotencyKey,
  }) {
    final product = _findProduct(sku);
    if (product == null) {
      throw const PpobApiException(
        code: 'PPOB_PRODUCT_NOT_FOUND',
        message: 'Produk PPOB tidak ditemukan.',
        statusCode: 404,
      );
    }
    // Replay: key yang sama mengembalikan order yang sama tanpa duplikasi.
    for (final existing in _orders) {
      if (existing['idempotencyKey'] == idempotencyKey) {
        return {...existing, 'replayed': true};
      }
    }
    _sequence += 1;
    final price = (product['price'] as double) + (product['adminFee'] as double);
    final now = DateTime.now().toIso8601String();
    final order = <String, dynamic>{
      'id': 'demo-ppob-order-$_sequence',
      'status': 'REFUNDED',
      'sku': product['sku'],
      'productName': product['name'],
      'categoryCode': 'DEMO',
      'targetNumber': targetNumber,
      'amount': price,
      'benefitAmount': 0,
      'balanceAmount': price,
      'failureReason': 'Provider PPOB belum terhubung (mode demo).',
      'providerRef': null,
      'idempotencyKey': idempotencyKey,
      'createdAt': now,
      'refundedAt': now,
      'replayed': false,
    };
    _orders.add(order);
    return Map<String, dynamic>.from(order);
  }

  Map<String, dynamic>? _findProduct(String sku) {
    for (final category in catalogJson) {
      for (final product
          in (category as Map<String, dynamic>)['products'] as List<dynamic>) {
        if ((product as Map<String, dynamic>)['sku'] == sku) {
          return product;
        }
      }
    }
    return null;
  }

  static Map<String, dynamic> _category(
    String id,
    String code,
    String name,
    String icon,
    int sortOrder,
    List<Map<String, dynamic>> products,
  ) =>
      {
        'id': id,
        'code': code,
        'name': name,
        'description': null,
        'icon': icon,
        'sortOrder': sortOrder,
        'products': products,
      };

  static Map<String, dynamic> _product(
    String id,
    String sku,
    String name,
    double price,
    double adminFee,
    String targetLabel,
    String targetPattern,
    int sortOrder,
  ) =>
      {
        'id': id,
        'sku': sku,
        'name': name,
        'description': null,
        'price': price,
        'adminFee': adminFee,
        'targetLabel': targetLabel,
        'targetPattern': targetPattern,
        'sortOrder': sortOrder,
      };
}
