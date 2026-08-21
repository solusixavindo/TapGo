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

/// Repository tipis: memparsing JSON backend menjadi model domain dan
/// meneruskan [PpobApiException] apa adanya. Tidak ada logika uang di sini.
class PpobRepository {
  const PpobRepository({
    required PpobCatalogRequest catalogRequest,
    required PpobInquiryRequest inquiryRequest,
    required PpobCreateOrderRequest createOrderRequest,
    required PpobOrdersRequest ordersRequest,
  })  : _catalogRequest = catalogRequest,
        _inquiryRequest = inquiryRequest,
        _createOrderRequest = createOrderRequest,
        _ordersRequest = ordersRequest;

  final PpobCatalogRequest _catalogRequest;
  final PpobInquiryRequest _inquiryRequest;
  final PpobCreateOrderRequest _createOrderRequest;
  final PpobOrdersRequest _ordersRequest;

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
}
