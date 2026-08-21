/// Stage R2.7 — model domain PPOB sisi customer.
///
/// Angka uang tiba dari backend sebagai string desimal Prisma ("11500.00");
/// di sini diparse sekali menjadi double untuk kebutuhan TAMPILAN. Semua
/// keputusan uang (cukup/tidak, pembagian saldo) dibuat backend — klien tidak
/// pernah menghitung ulang untuk keputusan.
library;

double _moneyFromJson(Object? value) {
  if (value is num) {
    return value.toDouble();
  }
  if (value is String) {
    return double.tryParse(value) ?? 0;
  }
  return 0;
}

String _stringFromJson(Object? value, [String fallback = '']) {
  return value is String ? value : fallback;
}

DateTime? _dateFromJson(Object? value) {
  if (value is String) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

class PpobProduct {
  const PpobProduct({
    required this.id,
    required this.sku,
    required this.name,
    required this.price,
    required this.adminFee,
    required this.targetLabel,
    this.description,
    this.targetPattern,
    this.sortOrder = 0,
  });

  final String id;
  final String sku;
  final String name;
  final String? description;
  final double price;
  final double adminFee;
  final String targetLabel;
  final String? targetPattern;
  final int sortOrder;

  double get totalPrice => price + adminFee;

  factory PpobProduct.fromJson(Map<String, dynamic> json) {
    return PpobProduct(
      id: _stringFromJson(json['id']),
      sku: _stringFromJson(json['sku']),
      name: _stringFromJson(json['name']),
      description: json['description'] is String ? json['description'] as String : null,
      price: _moneyFromJson(json['price']),
      adminFee: _moneyFromJson(json['adminFee']),
      targetLabel: _stringFromJson(json['targetLabel'], 'Nomor Tujuan'),
      targetPattern: json['targetPattern'] is String ? json['targetPattern'] as String : null,
      sortOrder: json['sortOrder'] is num ? (json['sortOrder'] as num).toInt() : 0,
    );
  }
}

class PpobCategory {
  const PpobCategory({
    required this.id,
    required this.code,
    required this.name,
    required this.products,
    this.description,
    this.icon,
    this.sortOrder = 0,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final String? icon;
  final int sortOrder;
  final List<PpobProduct> products;

  factory PpobCategory.fromJson(Map<String, dynamic> json) {
    final rawProducts = json['products'];
    return PpobCategory(
      id: _stringFromJson(json['id']),
      code: _stringFromJson(json['code']),
      name: _stringFromJson(json['name']),
      description: json['description'] is String ? json['description'] as String : null,
      icon: json['icon'] is String ? json['icon'] as String : null,
      sortOrder: json['sortOrder'] is num ? (json['sortOrder'] as num).toInt() : 0,
      products: rawProducts is List
          ? rawProducts
              .whereType<Map<String, dynamic>>()
              .map(PpobProduct.fromJson)
              .toList()
          : const [],
    );
  }
}

/// Rincian pemakaian saldo gabungan sebagaimana dihitung backend.
class PpobPaymentBreakdown {
  const PpobPaymentBreakdown({
    required this.amount,
    required this.benefitAmount,
    required this.balanceAmount,
    required this.sufficient,
  });

  final double amount;
  final double benefitAmount;
  final double balanceAmount;
  final bool sufficient;

  factory PpobPaymentBreakdown.fromJson(Map<String, dynamic> json) {
    return PpobPaymentBreakdown(
      amount: _moneyFromJson(json['amount']),
      benefitAmount: _moneyFromJson(json['benefitAmount']),
      balanceAmount: _moneyFromJson(json['balanceAmount']),
      sufficient: json['sufficient'] == true,
    );
  }
}

class PpobInquiryResult {
  const PpobInquiryResult({
    required this.product,
    required this.targetNumber,
    required this.payment,
    required this.walletBalance,
    required this.walletPpobBalance,
  });

  final PpobProduct product;
  final String targetNumber;
  final PpobPaymentBreakdown payment;
  final double walletBalance;
  final double walletPpobBalance;

  factory PpobInquiryResult.fromJson(Map<String, dynamic> json) {
    final productJson = json['product'];
    final paymentJson = json['payment'];
    final walletJson = json['wallet'];
    return PpobInquiryResult(
      product: productJson is Map<String, dynamic>
          ? PpobProduct.fromJson(productJson)
          : const PpobProduct(
              id: '',
              sku: '',
              name: '',
              price: 0,
              adminFee: 0,
              targetLabel: 'Nomor Tujuan',
            ),
      targetNumber: _stringFromJson(json['targetNumber']),
      payment: paymentJson is Map<String, dynamic>
          ? PpobPaymentBreakdown.fromJson(paymentJson)
          : const PpobPaymentBreakdown(
              amount: 0,
              benefitAmount: 0,
              balanceAmount: 0,
              sufficient: false,
            ),
      walletBalance: walletJson is Map<String, dynamic>
          ? _moneyFromJson(walletJson['balance'])
          : 0,
      walletPpobBalance: walletJson is Map<String, dynamic>
          ? _moneyFromJson(walletJson['ppobBalance'])
          : 0,
    );
  }
}

enum PpobOrderStatus { pending, processing, success, failed, refunded, unknown }

PpobOrderStatus ppobOrderStatusFromJson(Object? value) {
  return switch (value) {
    'PENDING' => PpobOrderStatus.pending,
    'PROCESSING' => PpobOrderStatus.processing,
    'SUCCESS' => PpobOrderStatus.success,
    'FAILED' => PpobOrderStatus.failed,
    'REFUNDED' => PpobOrderStatus.refunded,
    _ => PpobOrderStatus.unknown,
  };
}

class PpobOrder {
  const PpobOrder({
    required this.id,
    required this.status,
    required this.sku,
    required this.productName,
    required this.categoryCode,
    required this.targetNumber,
    required this.amount,
    required this.benefitAmount,
    required this.balanceAmount,
    this.failureReason,
    this.providerRef,
    this.createdAt,
    this.completedAt,
    this.refundedAt,
    this.replayed = false,
  });

  final String id;
  final PpobOrderStatus status;
  final String sku;
  final String productName;
  final String categoryCode;
  final String targetNumber;
  final double amount;
  final double benefitAmount;
  final double balanceAmount;
  final String? failureReason;
  final String? providerRef;
  final DateTime? createdAt;
  final DateTime? completedAt;
  final DateTime? refundedAt;

  /// True bila respons create adalah replay idempotency-key yang sama.
  final bool replayed;

  factory PpobOrder.fromJson(Map<String, dynamic> json) {
    return PpobOrder(
      id: _stringFromJson(json['id']),
      status: ppobOrderStatusFromJson(json['status']),
      sku: _stringFromJson(json['sku']),
      productName: _stringFromJson(json['productName']),
      categoryCode: _stringFromJson(json['categoryCode']),
      targetNumber: _stringFromJson(json['targetNumber']),
      amount: _moneyFromJson(json['amount']),
      benefitAmount: _moneyFromJson(json['benefitAmount']),
      balanceAmount: _moneyFromJson(json['balanceAmount']),
      failureReason: json['failureReason'] is String ? json['failureReason'] as String : null,
      providerRef: json['providerRef'] is String ? json['providerRef'] as String : null,
      createdAt: _dateFromJson(json['createdAt']),
      completedAt: _dateFromJson(json['completedAt']),
      refundedAt: _dateFromJson(json['refundedAt']),
      replayed: json['replayed'] == true,
    );
  }
}

/// Kegagalan API PPOB yang sudah dinormalisasi: [code] adalah kode operasional
/// stabil dari backend (PPOB_PROVIDER_UNAVAILABLE, INSUFFICIENT_BALANCE, dst).
class PpobApiException implements Exception {
  const PpobApiException({
    required this.code,
    required this.message,
    this.statusCode,
  });

  final String code;
  final String message;
  final int? statusCode;

  bool get isProviderUnavailable => code == 'PPOB_PROVIDER_UNAVAILABLE';
  bool get isInsufficientBalance => code == 'INSUFFICIENT_BALANCE';

  @override
  String toString() => 'PpobApiException($code, $statusCode): $message';
}
