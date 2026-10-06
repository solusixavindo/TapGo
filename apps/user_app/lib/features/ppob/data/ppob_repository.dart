import '../domain/ppob_models.dart';

/// Wire functions diisi oleh bootstrap aplikasi (main.dart) yang memiliki
/// akses ke HTTP client terautentikasi, atau oleh fake pada test/demo. Ini
/// adalah port batas Stage R2.8: implementasi nyata tidak berubah saat
/// provider biller nyata masuk — yang berubah hanya respons backend.
typedef PpobCatalogRequest = Future<List<dynamic>> Function();
typedef PpobInquiryRequest = Future<Map<String, dynamic>> Function({
  required String sku,
  required String targetNumber,
});
typedef PpobCreateOrderRequest = Future<Map<String, dynamic>> Function({
  required String sku,
  required String targetNumber,
  required String idempotencyKey,
});
typedef PpobOrdersRequest = Future<List<dynamic>> Function();
typedef PpobBillProductsRequest = Future<List<dynamic>> Function({
  required String category,
  String? query,
});
typedef PpobBillInquiryRequest = Future<Map<String, dynamic>> Function({
  required String sku,
  required String targetNumber,
});
typedef PpobBillPayRequest = Future<Map<String, dynamic>> Function({
  required String reference,
  required String idempotencyKey,
});

Future<T> _billUnavailable<T>() => Future<T>.error(
      const PpobApiException(
        code: 'PPOB_PROVIDER_UNAVAILABLE',
        message: 'Layanan tagihan belum tersedia.',
      ),
    );

/// Repository tipis: memparsing JSON backend menjadi model domain dan
/// meneruskan [PpobApiException] apa adanya. Tidak ada logika uang di sini.
class PpobRepository {
  const PpobRepository({
    required PpobCatalogRequest catalogRequest,
    required PpobInquiryRequest inquiryRequest,
    required PpobCreateOrderRequest createOrderRequest,
    required PpobOrdersRequest ordersRequest,
    PpobBillProductsRequest? billProductsRequest,
    PpobBillInquiryRequest? billInquiryRequest,
    PpobBillPayRequest? billPayRequest,
  })  : _catalogRequest = catalogRequest,
        _inquiryRequest = inquiryRequest,
        _createOrderRequest = createOrderRequest,
        _ordersRequest = ordersRequest,
        _billProductsRequest = billProductsRequest,
        _billInquiryRequest = billInquiryRequest,
        _billPayRequest = billPayRequest;

  final PpobCatalogRequest _catalogRequest;
  final PpobInquiryRequest _inquiryRequest;
  final PpobCreateOrderRequest _createOrderRequest;
  final PpobOrdersRequest _ordersRequest;
  final PpobBillProductsRequest? _billProductsRequest;
  final PpobBillInquiryRequest? _billInquiryRequest;
  final PpobBillPayRequest? _billPayRequest;

  Future<List<PpobCategory>> fetchCatalog() async {
    final raw = await _catalogRequest();
    return raw
        .whereType<Map<String, dynamic>>()
        .map(PpobCategory.fromJson)
        .toList();
  }

  Future<PpobInquiryResult> inquiry({
    required String sku,
    required String targetNumber,
  }) async {
    final raw = await _inquiryRequest(sku: sku, targetNumber: targetNumber);
    return PpobInquiryResult.fromJson(raw);
  }

  Future<PpobOrder> createOrder({
    required String sku,
    required String targetNumber,
    required String idempotencyKey,
  }) async {
    final raw = await _createOrderRequest(
      sku: sku,
      targetNumber: targetNumber,
      idempotencyKey: idempotencyKey,
    );
    return PpobOrder.fromJson(raw);
  }

  Future<List<PpobOrder>> fetchOrders() async {
    final raw = await _ordersRequest();
    return raw.whereType<Map<String, dynamic>>().map(PpobOrder.fromJson).toList();
  }

  /// Pascabayar: daftar produk BPJS/PDAM, dapat dicari menurut nama.
  Future<List<PpobBillProduct>> fetchBillProducts({
    required String category,
    String? query,
  }) async {
    final request = _billProductsRequest;
    if (request == null) return _billUnavailable();
    final raw = await request(category: category, query: query);
    return raw
        .whereType<Map<String, dynamic>>()
        .map(PpobBillProduct.fromJson)
        .toList();
  }

  /// Cek tagihan (tanpa memotong saldo).
  Future<PpobBillInquiry> billInquiry({
    required String sku,
    required String targetNumber,
  }) async {
    final request = _billInquiryRequest;
    if (request == null) return _billUnavailable();
    return PpobBillInquiry.fromJson(
      await request(sku: sku, targetNumber: targetNumber),
    );
  }

  /// Bayar tagihan yang sudah dicek; hanya referensi inquiry yang dikirim.
  Future<PpobOrder> billPay({
    required String reference,
    required String idempotencyKey,
  }) async {
    final request = _billPayRequest;
    if (request == null) return _billUnavailable();
    return PpobOrder.fromJson(
      await request(reference: reference, idempotencyKey: idempotencyKey),
    );
  }
}
