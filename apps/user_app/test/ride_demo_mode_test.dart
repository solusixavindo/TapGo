import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Test yang hanya bermakna di bawah flag compile-time.
///
/// `TAPGO_RIDE_DEMO_MODE` dan `TAPGO_DISTRIBUTION` dibaca lewat
/// `String.fromEnvironment`, jadi nilainya tidak dapat diubah saat runtime.
/// Karena itu file ini menjaga dirinya sendiri: pada `flutter test` biasa
/// bagian yang butuh flag dilewati dengan alasan yang jelas, dan dijalankan
/// terpisah dengan perintah berikut.
///
///   flutter test test/ride_demo_mode_test.dart \
///     --dart-define=TAPGO_RIDE_DEMO_MODE=true \
///     --dart-define=TAPGO_DISTRIBUTION=direct
///
/// Pelewatan bukan kelulusan: laporan Stage R2.4 mencantumkan hasil kedua
/// jalur secara terpisah.

Widget wrapRide(Widget child) {
  return ProviderScope(
    child: MaterialApp(
      theme: ThemeData.light(useMaterial3: true),
      home: child,
    ),
  );
}

void useTallView(WidgetTester tester) {
  tester.view.physicalSize = const Size(412 * 3, 1400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> settleFrames(WidgetTester tester, {int frames = 12}) async {
  for (var index = 0; index < frames; index += 1) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

Map<String, dynamic> orderPayload({String status = 'SEARCHING_DRIVER'}) {
  return {
    'reference': 'RID-A2B3C4D5E6',
    'serviceType': 'MOTORCYCLE',
    'status': status,
    'isFinal': false,
    'pickupAddress': 'LOKASI_DEMO_A — Titik Uji Utara',
    'dropoffAddress': 'LOKASI_DEMO_B — Titik Uji Tengah',
    'distanceMeters': 4200,
    'durationSeconds': 900,
    'fare': const {'totalFare': 18500, 'currency': 'IDR'},
    'payment': const {'method': 'CASH', 'state': 'PENDING'},
    'cancellation': null,
    'timeline': const {},
    'driver': null,
    'vehicle': null,
    'createdAt': DateTime.now().toUtc().toIso8601String(),
  };
}

void main() {
  setUp(() {
    tapGoDisablePersistenceForTests = true;
    // Tap dashboard nyata melewati gerbang pemulihan, yang memanggil
    // GET /api/v1/rides. Hook ini membuatnya tidak pernah menembak jaringan.
    tapGoRideHistoryLoaderForTests = () async => const [];
  });

  tearDown(() {
    tapGoRideHistoryLoaderForTests = null;
  });

  group('mode demo aktif', () {
    test('4. flag demo menyala dan port demo terpasang', () async {
      expect(tapGoRideDemoMode, isTrue);
      expect(tapGoRideLocationPort(), isA<DemoLocationPort>());
      expect(
        tapGoRideLocationPort().status,
        RideLocationProviderStatus.ready,
      );
      expect(
        await tapGoRideLocationPort().searchAddress('lokasi'),
        hasLength(3),
      );
      // Dilewati tanpa --dart-define=TAPGO_RIDE_DEMO_MODE=true.
    }, skip: !tapGoRideDemoMode);

    testWidgets('4b. layar pemesanan menampilkan label DEMO DATA', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          const RideBookingScreen(initialService: RideServiceKind.motorcycle),
        ),
      );
      await settleFrames(tester);

      expect(find.textContaining(tapGoRideDemoLabel), findsOneWidget);
      expect(find.textContaining('lokasi sintetis'), findsOneWidget);
      // Provider demo membuat pemesanan dapat dilanjutkan.
      expect(find.text('Cek Harga'), findsOneWidget);
      expect(find.text('LOKASI_DEMO_A'), findsWidgets);
      // Dilewati tanpa --dart-define=TAPGO_RIDE_DEMO_MODE=true.
    }, skip: !tapGoRideDemoMode);

    testWidgets('4c. layar status menampilkan label DEMO DATA', (tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(orderPayload()),
          ),
        ),
      );
      await settleFrames(tester);

      expect(find.textContaining(tapGoRideDemoLabel), findsOneWidget);
      // Dilewati tanpa --dart-define=TAPGO_RIDE_DEMO_MODE=true.
    }, skip: !tapGoRideDemoMode);

    testWidgets('4d. layar riwayat menampilkan label DEMO DATA', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(RideHistoryScreen(historyRequest: () async => const [])),
      );
      await settleFrames(tester);

      expect(find.textContaining(tapGoRideDemoLabel), findsOneWidget);
      expect(find.text('Belum ada perjalanan'), findsOneWidget);
      // Dilewati tanpa --dart-define=TAPGO_RIDE_DEMO_MODE=true.
    }, skip: !tapGoRideDemoMode);
  });
}
