import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Tahap A: pengalaman ojek yang lebih hidup — indikator langkah, radar,
/// getar pada tahap penting, struk dan "Pesan lagi", tempat cepat, skeleton.
Map<String, dynamic> order({
  String status = 'COMPLETED',
  String service = 'MOTORCYCLE',
  bool coords = true,
  Map<String, dynamic>? cancellation,
  Map<String, dynamic>? driver = const {'displayName': 'Budi'},
  Map<String, dynamic>? vehicle = const {
    'serviceType': 'MOTORCYCLE',
    'model': 'Vario 160',
    'color': 'Hitam',
    'maskedPlate': 'B 12•• XYZ',
  },
  String pickup = 'Jl. Melati 1, Serang',
  String dropoff = 'Stasiun Serang, Serang',
  String reference = 'RID-1',
  String payment = 'CASH',
}) =>
    {
      'reference': reference,
      'serviceType': service,
      'status': status,
      'isFinal': status == 'COMPLETED' || status.startsWith('CANCELLED'),
      'pickupAddress': pickup,
      'dropoffAddress': dropoff,
      if (coords) 'pickup': {'lat': -6.11, 'lng': 106.15},
      if (coords) 'dropoff': {'lat': -6.12, 'lng': 106.16},
      'distanceMeters': 4200,
      'durationSeconds': 900,
      'fare': {'totalFare': 18500, 'currency': 'IDR'},
      'payment': {'method': payment, 'state': 'PAID'},
      'cancellation': cancellation,
      'driver': driver,
      'vehicle': vehicle,
      'createdAt': '2026-09-20T10:05:00Z',
    };

Widget host(Widget child) => ProviderScope(child: MaterialApp(home: child));

void main() {
  setUp(() async {
    tapGoDisablePersistenceForTests = true;
    await tapGoResetSavedPlacesForTests();
  });
  tearDown(() => tapGoDisablePersistenceForTests = false);

  group('indikator langkah', () {
    testWidgets('mencari driver: radar, teks lama tetap ada, langkah 1 dari 4',
        (tester) async {
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        initialOrder: RideOrderView.fromJson(
            order(status: 'SEARCHING_DRIVER', driver: null, vehicle: null)),
        autoStart: false,
      )));
      await tester.pumpAndSettle();
      expect(find.text('Mencari driver'), findsWidgets);
      expect(
          find.text('Menghubungkan dengan driver terdekat…'), findsOneWidget);
      expect(find.bySemanticsLabel('Langkah 1 dari 4: Cari driver'),
          findsOneWidget);
      expect(find.text('Batalkan perjalanan'), findsOneWidget);
    });

    testWidgets('driver menuju jemput: langkah 2 dan keterangan',
        (tester) async {
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        initialOrder: RideOrderView.fromJson(order(status: 'DRIVER_TO_PICKUP')),
        autoStart: false,
      )));
      await tester.pumpAndSettle();
      expect(
          find.bySemanticsLabel('Langkah 2 dari 4: Dijemput'), findsOneWidget);
      expect(find.text('Driver sedang menuju titik jemput.'), findsOneWidget);
      expect(find.text('Menghubungkan dengan driver terdekat…'), findsNothing);
    });

    testWidgets('selesai: langkah 4 dan ucapan terima kasih', (tester) async {
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        initialOrder: RideOrderView.fromJson(order()),
        autoStart: false,
      )));
      await tester.pumpAndSettle();
      expect(
          find.bySemanticsLabel('Langkah 4 dari 4: Selesai'), findsOneWidget);
      expect(find.text('Terima kasih sudah memakai TapGo.'), findsOneWidget);
    });

    testWidgets('dibatalkan: tanpa indikator langkah', (tester) async {
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        initialOrder: RideOrderView.fromJson(order(
            status: 'CANCELLED_BY_PASSENGER', driver: null, vehicle: null)),
        autoStart: false,
      )));
      await tester.pumpAndSettle();
      expect(find.textContaining('Langkah'), findsNothing);
      expect(find.text('Dibatalkan olehmu'), findsOneWidget);
    });
  });

  group('getar pada tahap penting', () {
    late List<String> haptics;
    setUp(() {
      haptics = [];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') {
          haptics.add('${call.arguments}');
        }
        return null;
      });
    });
    tearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));

    testWidgets('sekali saat driver ditemukan, tidak pada polling berulang',
        (tester) async {
      final statuses = [
        'SEARCHING_DRIVER',
        'SEARCHING_DRIVER',
        'DRIVER_ASSIGNED',
        'DRIVER_ASSIGNED',
        'DRIVER_ASSIGNED'
      ];
      var call = 0;
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        pollInterval: const Duration(milliseconds: 100),
        detailRequest: (_) async {
          final status =
              statuses[call < statuses.length ? call : statuses.length - 1];
          call += 1;
          return order(
              status: status,
              driver: status == 'DRIVER_ASSIGNED'
                  ? const {'displayName': 'Budi'}
                  : null,
              vehicle: status == 'DRIVER_ASSIGNED'
                  ? const {
                      'serviceType': 'MOTORCYCLE',
                      'maskedPlate': 'B 1•• X'
                    }
                  : null);
        },
      )));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(haptics.where((h) => h.contains('mediumImpact')), hasLength(1));
      expect(haptics.where((h) => h.contains('heavyImpact')), isEmpty);
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('struk perjalanan', () {
    testWidgets(
        'perjalanan selesai: rute, tarif, pembayaran, driver, ringkasan',
        (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final view = RideOrderView.fromJson(order(payment: 'DIGITAL'));
      await tester.pumpWidget(host(RideReceiptScreen(order: view)));
      await tester.pumpAndSettle();

      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.text('Jl. Melati 1, Serang'), findsOneWidget);
      expect(find.text('Stasiun Serang, Serang'), findsOneWidget);
      expect(find.text('4,2 km'), findsOneWidget);
      expect(find.text('15 menit'), findsOneWidget);
      expect(find.text('TapGoPay'), findsOneWidget);
      expect(find.text('Rp 18.500'), findsOneWidget);
      expect(find.text('Budi'), findsOneWidget);
      expect(find.text('Vario 160 • Hitam • B 12•• XYZ'), findsOneWidget);
      expect(find.text('Pesan lagi'), findsOneWidget);
      expect(view.hasRouteCoordinates, isTrue);
    });

    testWidgets('dibatalkan: alasan dan tanpa tarif', (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final view = RideOrderView.fromJson(order(
        status: 'CANCELLED_BY_PASSENGER',
        driver: null,
        vehicle: null,
        cancellation: const {'reason': 'CHANGE_OF_PLAN', 'fee': 0},
      ));
      await tester.pumpWidget(host(RideReceiptScreen(order: view)));
      await tester.pumpAndSettle();

      expect(find.text('Dibatalkan olehmu'), findsOneWidget);
      expect(find.text('Tarif'), findsNothing);
      expect(find.text(tapGoRideCancellationReasons['CHANGE_OF_PLAN']!),
          findsOneWidget);
    });

    testWidgets('tanpa koordinat dari server: tidak menawarkan Pesan lagi',
        (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(host(RideReceiptScreen(
          order: RideOrderView.fromJson(order(coords: false)))));
      await tester.pumpAndSettle();
      expect(find.text('Pesan lagi'), findsNothing);
      expect(find.text('Salin ringkasan'), findsOneWidget);
    });

    testWidgets(
        'Pesan lagi membuka pemesanan dengan rute dan layanan yang sama',
        (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final view = RideOrderView.fromJson(order(service: 'CAR'));
      await tester.pumpWidget(host(RideReceiptScreen(order: view)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pesan lagi'));
      await tester.pumpAndSettle();

      final booking =
          tester.widget<RideBookingScreen>(find.byType(RideBookingScreen));
      expect(booking.initialService, RideServiceKind.car);
      expect(booking.initialPickup?.address, 'Jl. Melati 1, Serang');
      expect(booking.initialDropoff?.address, 'Stasiun Serang, Serang');
      expect(booking.initialDropoff?.lat, -6.12);
    });

    testWidgets('Salin ringkasan menaruh teks tanpa data driver di clipboard',
        (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      String? copied;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String;
        }
        return null;
      });
      addTearDown(() => TestDefaultBinaryMessengerBinding
          .instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null));
      await tester.pumpWidget(
          host(RideReceiptScreen(order: RideOrderView.fromJson(order()))));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Salin ringkasan'));
      await tester.tap(find.text('Salin ringkasan'));
      await tester.pump();

      expect(copied, contains('TapGo Ojek Motor'));
      expect(copied, contains('Dari: Jl. Melati 1, Serang'));
      expect(copied, contains('Tarif Rp 18.500 (Tunai)'));
      expect(copied, contains('Kode: RID-1'));
      expect(copied, isNot(contains('Budi')));
    });

    testWidgets('kartu riwayat bisa diketuk dan membuka struk', (tester) async {
      await tester.pumpWidget(host(
          RideHistoryScreen(initialItems: [RideOrderView.fromJson(order())])));
      await tester.pumpAndSettle();
      expect(find.text('Lihat struk'), findsOneWidget);
      await tester.tap(find.text('Lihat struk'));
      await tester.pumpAndSettle();
      expect(find.byType(RideReceiptScreen), findsOneWidget);
    });
  });

  group('tempat cepat', () {
    test(
        'tempat tersimpan: data rusak dibuang, koordinat di luar rentang ditolak',
        () {
      expect(
          RideSavedPlace.tryFromJson({
            'slot': 'home',
            'address': 'Jl. A 1',
            'lat': -6.1,
            'lng': 106.1
          }),
          isNotNull);
      expect(
          RideSavedPlace.tryFromJson(
              {'slot': 'x', 'address': 'Jl. A 1', 'lat': 1, 'lng': 1}),
          isNull);
      expect(
          RideSavedPlace.tryFromJson(
              {'slot': 'home', 'address': 'ab', 'lat': 1, 'lng': 1}),
          isNull);
      expect(
          RideSavedPlace.tryFromJson(
              {'slot': 'home', 'address': 'Jl. A 1', 'lat': 91, 'lng': 1}),
          isNull);
      expect(
          RideSavedPlace.tryFromJson(
              {'slot': 'home', 'address': 'Jl. A 1', 'lat': 1, 'lng': 'x'}),
          isNull);
      expect(RideSavedPlace.tryFromJson('bukan map'), isNull);
    });

    test('tujuan terakhir: hanya perjalanan selesai, unik, maksimal 3', () {
      final orders = [
        order(dropoff: 'A, Kota'),
        order(dropoff: 'a, kota'),
        order(dropoff: 'B, Kota'),
        order(dropoff: 'C, Kota', status: 'CANCELLED_BY_PASSENGER'),
        order(dropoff: 'D, Kota'),
        order(dropoff: 'E, Kota'),
        order(dropoff: 'F, Kota', coords: false),
      ].map(RideOrderView.fromJson).toList();
      final recent = tapGoRecentPlacesFrom(orders);
      expect(recent.map((p) => p.label), ['A', 'B', 'D']);
    });

    testWidgets(
        'simpan tujuan sebagai Rumah lalu muncul sebagai chip yang bisa dipakai',
        (tester) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      const dropoff = RideLocation(
          id: 'x',
          label: 'Stasiun',
          address: 'Stasiun Serang, Serang',
          lat: -6.12,
          lng: 106.16);
      await tester.pumpWidget(host(const RideBookingScreen(
        initialService: RideServiceKind.motorcycle,
        initialDropoff: dropoff,
        locationPort: DemoLocationPort(),
      )));
      await tester.pumpAndSettle();
      expect(find.text('Simpan sebagai Rumah'), findsOneWidget);
      expect(find.text('Rumah'), findsNothing);

      await tester.ensureVisible(find.text('Simpan sebagai Rumah'));
      await tester.tap(find.text('Simpan sebagai Rumah'));
      await tester.pumpAndSettle();

      expect(find.text('Rumah'), findsOneWidget);
      final stored = await TapGoSavedPlacesProbe.load();
      expect(stored.single.slot, 'home');
      expect(stored.single.address, 'Stasiun Serang, Serang');
    });
  });

  group('skeleton dan animasi', () {
    testWidgets('skeleton tidak menggantung pumpAndSettle dan berlabel Memuat',
        (tester) async {
      await tester.pumpWidget(host(const Scaffold(
          body: SingleChildScrollView(child: SkeletonForTests(count: 3)))));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Memuat'), findsOneWidget);
    });

    testWidgets(
        'animasi berulang jalan bila dipaksa dan berhenti bersih saat dilepas',
        (tester) async {
      tapGoForceLoopAnimationsForTests = true;
      addTearDown(() => tapGoForceLoopAnimationsForTests = false);
      await tester.pumpWidget(host(const Scaffold(
          body: SingleChildScrollView(child: SkeletonForTests(count: 2)))));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 300));
      }
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    });

    testWidgets('mode hapus-animasi sistem mematikan animasi berulang',
        (tester) async {
      tapGoForceLoopAnimationsForTests = true;
      addTearDown(() => tapGoForceLoopAnimationsForTests = false);
      await tester.pumpWidget(MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: host(const Scaffold(body: SkeletonForTests(count: 1))),
      ));
      await tester.pumpAndSettle();
    });
  });
}
