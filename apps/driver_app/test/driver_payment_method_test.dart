import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

void main() {
  Map<String, dynamic> ride(Object? payment) => {
        'reference': 'RID-TEST000001',
        'serviceType': 'MOTORCYCLE',
        'status': 'DRIVER_ASSIGNED',
        'pickupAddress': 'A',
        'dropoffAddress': 'B',
        'fare': {'totalFare': 9000},
        if (payment != null) 'payment': payment,
      };

  test('pembayaran TapGoPay ditandai sudah dibayar (jangan tagih tunai)', () {
    final parsed = DriverRide.fromJson(ride({'method': 'DIGITAL'}));
    expect(parsed.isPaidDigitally, isTrue);
  });

  test('tunai, tanpa field payment, atau nilai asing diperlakukan tunai', () {
    expect(DriverRide.fromJson(ride({'method': 'CASH'})).isPaidDigitally, isFalse);
    expect(DriverRide.fromJson(ride(null)).isPaidDigitally, isFalse);
    expect(DriverRide.fromJson(ride({'method': 'APA_SAJA'})).isPaidDigitally, isFalse);
  });
}
