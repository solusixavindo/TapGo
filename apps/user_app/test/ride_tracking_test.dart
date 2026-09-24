import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Tahap B1: posisi driver bergerak di peta perjalanan.
Map<String, dynamic> order({
  String status = 'DRIVER_TO_PICKUP',
  bool coords = true,
}) =>
    {
      'reference': 'RID-1',
      'serviceType': 'MOTORCYCLE',
      'status': status,
      'isFinal': status == 'COMPLETED',
      'pickupAddress': 'Jl. Melati 1, Serang',
      'dropoffAddress': 'Stasiun Serang, Serang',
      if (coords) 'pickup': {'lat': -6.11, 'lng': 106.15},
      if (coords) 'dropoff': {'lat': -6.12, 'lng': 106.16},
      'distanceMeters': 4200,
      'durationSeconds': 900,
      'fare': {'totalFare': 18500},
      'payment': {'method': 'CASH', 'state': 'PENDING'},
      'driver': {'displayName': 'Budi'},
      'vehicle': {'serviceType': 'MOTORCYCLE', 'maskedPlate': 'B 1•• X'},
      'createdAt': '2026-09-20T10:05:00Z',
    };

Map<String, dynamic> fixJson({
  bool available = true,
  double lat = -6.115,
  double lng = 106.155,
  bool stale = false,
  String target = 'PICKUP',
  int eta = 240,
  int distance = 1234,
}) =>
    available
        ? {
            'available': true,
            'lat': lat,
            'lng': lng,
            'stale': stale,
            'ageSeconds': stale ? 200 : 4,
            'target': target,
            'distanceMeters': distance,
            'etaSeconds': eta,
          }
        : {'available': false, 'reason': 'NO_FIX'};

Widget host(Widget child) => ProviderScope(child: MaterialApp(home: child));

Future<void> pumpMs(WidgetTester tester, int ms) async {
  for (var i = 0; i < ms ~/ 100; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() => tapGoDisablePersistenceForTests = false);

  group('RideDriverFix', () {
    test('tidak tersedia atau isi tak masuk akal menjadi null', () {
      expect(RideDriverFix.tryFromJson(fixJson(available: false)), isNull);
      expect(RideDriverFix.tryFromJson(null), isNull);
      expect(RideDriverFix.tryFromJson('x'), isNull);
      expect(RideDriverFix.tryFromJson({'available': true}), isNull);
      expect(RideDriverFix.tryFromJson(fixJson(lat: 95)), isNull);
      expect(RideDriverFix.tryFromJson(fixJson(lng: -200)), isNull);
      expect(
          RideDriverFix.tryFromJson({'available': true, 'lat': 'a', 'lng': 1}),
          isNull);
    });

    test('terbaca lengkap; angka negatif/aneh dinolkan', () {
      final fix = RideDriverFix.tryFromJson({
        ...fixJson(target: 'DROPOFF'),
        'routePolyline': '_p~iF~ps|U_ulLnnqC',
        'etaSeconds': -5,
        'distanceMeters': 'abc',
      })!;
      expect(fix.toDropoff, isTrue);
      expect(fix.etaSeconds, 0);
      expect(fix.distanceMeters, 0);
      expect(fix.routePolyline, isNotNull);
      expect(fix.stale, isFalse);
    });

    test('label ETA dan jarak', () {
      expect(tapGoRideEtaLabel(30), 'kurang dari 1 menit');
      expect(tapGoRideEtaLabel(240), 'sekitar 4 menit');
      expect(tapGoRideEtaLabel(7200), 'lebih dari 1,5 jam');
      expect(tapGoRideDistanceLabel(347), '350 m');
      expect(tapGoRideDistanceLabel(1234), '1,2 km');
    });
  });

  group('RideDriverTracker', () {
    testWidgets('memuat langsung lalu berkala, berhenti saat dilepas',
        (tester) async {
      var calls = 0;
      final fixes = <RideDriverFix?>[];
      final tracker = RideDriverTracker(
        reference: 'RID-1',
        interval: const Duration(seconds: 5),
        fetch: (_) async {
          calls += 1;
          return fixJson(lat: -6.1 - calls / 1000);
        },
        onFix: fixes.add,
      )..start();
      await pumpMs(tester, 100);
      expect(calls, 1);
      await pumpMs(tester, 5000);
      expect(calls, 2);
      tracker.dispose();
      await pumpMs(tester, 20000);
      expect(calls, 2, reason: 'setelah dilepas tidak ada permintaan lagi');
      expect(fixes.length, 2);
    });

    testWidgets(
        'gagal: jeda digandakan hingga batas, kembali normal saat berhasil',
        (tester) async {
      var calls = 0;
      var fail = true;
      final tracker = RideDriverTracker(
        reference: 'RID-1',
        interval: const Duration(seconds: 5),
        maxBackoff: const Duration(seconds: 20),
        fetch: (_) async {
          calls += 1;
          if (fail) throw StateError('mati');
          return fixJson();
        },
        onFix: (_) {},
      )..start();
      await pumpMs(tester, 100); // t=0.1: panggilan 1 (gagal) → jeda 10 dtk
      expect(calls, 1);
      await pumpMs(tester,
          5000); // t=5.1: jadwal 5 dtk sudah terpasang sebelum gagal? tidak menambah
      final afterFirst = calls;
      await pumpMs(tester, 40000);
      // Dalam 40 detik dengan jeda membesar 10/20/20... jauh lebih sedikit dari 8 kali polling 5 dtk.
      expect(calls - afterFirst, lessThanOrEqualTo(3));
      fail = false;
      await pumpMs(tester, 25000);
      final ok = calls;
      await pumpMs(tester, 5100);
      expect(calls, ok + 1,
          reason: 'kembali ke jeda normal 5 detik setelah berhasil');
      tracker.dispose();
    });

    testWidgets('tidak menumpuk permintaan saat satu masih berjalan',
        (tester) async {
      var calls = 0;
      final tracker = RideDriverTracker(
        reference: 'RID-1',
        interval: const Duration(seconds: 1),
        fetch: (_) async {
          calls += 1;
          await Future<void>.delayed(const Duration(seconds: 3));
          return fixJson();
        },
        onFix: (_) {},
      )..start();
      await pumpMs(tester, 2500);
      expect(calls, 1);
      tracker.dispose();
      await pumpMs(tester, 5000);
    });
  });

  group('layar status dengan peta', () {
    Future<void> open(
      WidgetTester tester, {
      required Map<String, dynamic> orderJson,
      required Future<Map<String, dynamic>> Function(String) location,
    }) async {
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        initialOrder: RideOrderView.fromJson(orderJson),
        autoStart: false,
        driverLocationRequest: location,
        trackInterval: const Duration(seconds: 1),
      )));
      await pumpMs(tester, 300);
    }

    testWidgets('menuju titik jemput: peta, ETA, jarak, dan marker driver',
        (tester) async {
      await open(tester, orderJson: order(), location: (_) async => fixJson());
      expect(find.byType(FlutterMap), findsOneWidget);
      expect(find.text('Menuju titik jemput • sekitar 4 menit • 1,2 km'),
          findsOneWidget);
      expect(find.byIcon(Icons.two_wheeler_rounded), findsWidgets);
      expect(find.byIcon(Icons.trip_origin_rounded), findsOneWidget);
      // Kamera memuat driver dan titik jemput; tujuan menyusul saat perjalanan berlangsung.
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('perjalanan berlangsung: menuju tujuan', (tester) async {
      await open(tester,
          orderJson: order(status: 'IN_TRIP'),
          location: (_) async =>
              fixJson(target: 'DROPOFF', eta: 600, distance: 4000));
      expect(find.text('Menuju tujuan • sekitar 10 menit • 4,0 km'),
          findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('driver tiba: keterangan di titik jemput', (tester) async {
      await open(tester,
          orderJson: order(status: 'DRIVER_ARRIVED'),
          location: (_) async => fixJson(eta: 5, distance: 20));
      expect(find.text('Driver sudah di titik jemput.'), findsWidgets);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('titik basi: tidak dipresentasikan sebagai langsung',
        (tester) async {
      await open(tester,
          orderJson: order(), location: (_) async => fixJson(stale: true));
      expect(find.text('Menunggu sinyal terbaru dari driver…'), findsOneWidget);
      expect(find.textContaining('sekitar'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets(
        'belum ada titik atau server gagal: menunggu lokasi, tanpa crash',
        (tester) async {
      await open(tester,
          orderJson: order(), location: (_) async => fixJson(available: false));
      expect(find.text('Menunggu lokasi driver…'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());

      await open(tester,
          orderJson: order(), location: (_) async => throw StateError('mati'));
      expect(find.text('Menunggu lokasi driver…'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('mencari driver: tanpa peta dan tanpa permintaan posisi',
        (tester) async {
      var calls = 0;
      await open(tester, orderJson: order(status: 'SEARCHING_DRIVER'),
          location: (_) async {
        calls += 1;
        return fixJson();
      });
      expect(find.byType(FlutterMap), findsNothing);
      expect(calls, 0);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('server lama tanpa koordinat: tanpa peta dan tanpa permintaan',
        (tester) async {
      var calls = 0;
      await open(tester, orderJson: order(coords: false), location: (_) async {
        calls += 1;
        return fixJson();
      });
      expect(find.byType(FlutterMap), findsNothing);
      expect(calls, 0);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('pelacakan berhenti di latar belakang dan lanjut saat kembali',
        (tester) async {
      var calls = 0;
      await open(tester, orderJson: order(), location: (_) async {
        calls += 1;
        return fixJson();
      });
      final before = calls;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await pumpMs(tester, 5000);
      expect(calls, before,
          reason: 'tidak ada permintaan saat di latar belakang');
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await pumpMs(tester, 300);
      expect(calls, greaterThan(before));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('perjalanan selesai: pelacakan berhenti dan peta hilang',
        (tester) async {
      var status = 'DRIVER_TO_PICKUP';
      var calls = 0;
      tester.view.physicalSize = const Size(1080, 2600);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(host(RideStatusScreen(
        reference: 'RID-1',
        pollInterval: const Duration(milliseconds: 200),
        trackInterval: const Duration(milliseconds: 300),
        detailRequest: (_) async => order(status: status),
        driverLocationRequest: (_) async {
          calls += 1;
          return fixJson();
        },
      )));
      await pumpMs(tester, 1000);
      expect(find.byType(FlutterMap), findsOneWidget);
      status = 'COMPLETED';
      await pumpMs(tester, 600);
      final atComplete = calls;
      await pumpMs(tester, 3000);
      expect(calls, atComplete,
          reason: 'tidak ada permintaan posisi setelah selesai');
      expect(find.byType(FlutterMap), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });
  });
}
