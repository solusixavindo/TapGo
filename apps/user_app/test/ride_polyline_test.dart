import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

void main() {
  group('tapGoDecodePolyline', () {
    test('mendekode contoh referensi resmi algoritma polyline (Google)', () {
      const encoded = r'_p~iF~ps|U_ulLnnqC_mqNvxq`@';
      final points = tapGoDecodePolyline(encoded);

      expect(points, hasLength(3));
      expect(points[0].latitude, closeTo(38.5, 0.0001));
      expect(points[0].longitude, closeTo(-120.2, 0.0001));
      expect(points[1].latitude, closeTo(40.7, 0.0001));
      expect(points[1].longitude, closeTo(-120.95, 0.0001));
      expect(points[2].latitude, closeTo(43.252, 0.0001));
      expect(points[2].longitude, closeTo(-126.453, 0.0001));
    });

    test('string kosong menghasilkan list kosong, bukan error', () {
      expect(tapGoDecodePolyline(''), isEmpty);
    });

    test('string rusak/acak tidak melempar, mengembalikan list kosong', () {
      expect(() => tapGoDecodePolyline('###tidak-valid###'), returnsNormally);
    });
  });

  group('RideQuoteView.fromJson routePolyline', () {
    test('mengisi routePolyline saat ada di respons', () {
      final quote = RideQuoteView.fromJson({
        'quoteId': 'q1',
        'serviceType': 'MOTORCYCLE',
        'distanceMeters': 1000,
        'durationSeconds': 200,
        'etaSeconds': 100,
        'fare': {
          'baseFare': 1,
          'distanceFare': 1,
          'serviceFee': 1,
          'subtotalFare': 1,
          'totalFare': 1,
        },
        'routePolyline': 'abc',
      });
      expect(quote.routePolyline, 'abc');
    });

    test('routePolyline null saat tidak ada di respons (provider LOCAL)', () {
      final quote = RideQuoteView.fromJson({
        'quoteId': 'q1',
        'serviceType': 'MOTORCYCLE',
        'distanceMeters': 1000,
        'durationSeconds': 200,
        'etaSeconds': 100,
        'fare': {
          'baseFare': 1,
          'distanceFare': 1,
          'serviceFee': 1,
          'subtotalFare': 1,
          'totalFare': 1,
        },
      });
      expect(quote.routePolyline, isNull);
    });
  });
}
