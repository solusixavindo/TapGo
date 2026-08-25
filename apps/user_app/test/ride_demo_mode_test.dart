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

  group('entry point dashboard distribusi direct', () {
    Future<void> openDashboard(WidgetTester tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        const ProviderScope(child: MaterialApp(home: TapGoDashboard())),
      );
      await settleFrames(tester);

      // Dashboard distribusi direct sudah overflow 74 px pada kartu promo
      // "Kelas Online Spesial" sejak commit frozen 9d5c5c9befd1 — terbukti
      // dengan merender dashboard versi frozen tanpa perubahan Stage R2.4.
      // Struktur Dashboard tidak boleh diubah pada stage ini, jadi overflow
      // itu dibiarkan apa adanya dan hanya dikeluarkan dari antrean exception
      // supaya test ini benar-benar menguji navigasi entry point.
      final pending = tester.takeException();
      if (pending != null) {
        expect(
          pending.toString(),
          contains('overflowed'),
          reason: 'hanya overflow pre-existing yang boleh diabaikan',
        );
      }
    }

    /// Menyentuh kartu layanan pada grid, bukan judul promo dengan teks sama.
    Future<void> tapServiceTile(WidgetTester tester, String label) async {
      final tile = find
          .descendant(of: find.byType(GridView), matching: find.text(label))
          .first;
      await tester.ensureVisible(tile);
      await settleFrames(tester);
      await tester.tap(tile);
      await settleFrames(tester);
    }

    testWidgets('1c. kartu TapGo Ride di dashboard membuka alur MOTORCYCLE', (
      tester,
    ) async {
      expect(tapGoIsPlayDistribution, isFalse);
      await openDashboard(tester);
      await tapServiceTile(tester, 'TapGo Ride');

      // Entry membuka gerbang pemulihan; jenis layanan diteruskan apa adanya.
      final gate = tester.widget<RideEntryScreen>(
        find.byType(RideEntryScreen),
      );
      expect(gate.service, RideServiceKind.motorcycle);
      // Tanpa perjalanan aktif, gerbang jatuh ke alur pemesanan.
      final booking = tester.widget<RideBookingScreen>(
        find.byType(RideBookingScreen),
      );
      expect(booking.initialService, RideServiceKind.motorcycle);
      // Dilewati tanpa --dart-define=TAPGO_DISTRIBUTION=direct.
    }, skip: tapGoIsPlayDistribution);

    testWidgets('2c. kartu TapGo Car di dashboard membuka alur CAR', (
      tester,
    ) async {
      expect(tapGoIsPlayDistribution, isFalse);
      await openDashboard(tester);
      await tapServiceTile(tester, 'TapGo Car');

      // Entry membuka gerbang pemulihan; jenis layanan diteruskan apa adanya.
      final gate = tester.widget<RideEntryScreen>(
        find.byType(RideEntryScreen),
      );
      expect(gate.service, RideServiceKind.car);
      // Tanpa perjalanan aktif, gerbang jatuh ke alur pemesanan.
      final booking = tester.widget<RideBookingScreen>(
        find.byType(RideBookingScreen),
      );
      expect(booking.initialService, RideServiceKind.car);
      // Dilewati tanpa --dart-define=TAPGO_DISTRIBUTION=direct.
    }, skip: tapGoIsPlayDistribution);
  });
}
