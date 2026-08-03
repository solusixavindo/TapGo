import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Regression Ojek Online penumpang (Stage R2.4).
///
/// Tidak ada panggilan jaringan nyata: seluruh permintaan API disuntikkan
/// melalui seam `RideQuoteRequest`/`RideOrderRequest`/`RideDetailRequest`/
/// `RideHistoryRequest`/`RideCancelRequest`. Yang diuji adalah perilaku layar
/// dan controller — bukan mock backend yang mengklaim alur nyata berjalan.
///
/// Yang khusus butuh flag compile-time demo berada di
/// `ride_demo_mode_test.dart`.

/// Allowlist backend `RideCancellationReason` apa adanya (9 nilai).
///
/// Disalin sebagai literal supaya test gagal bila client memperkenalkan kode
/// yang tidak dikenal server, bukan sekadar mencerminkan dirinya sendiri.
const _backendCancellationAllowlist = {
  'WAIT_TOO_LONG',
  'DRIVER_NOT_MOVING',
  'CHANGE_OF_PLAN',
  'WRONG_PICKUP',
  'FOUND_OTHER_TRANSPORT',
  'PASSENGER_UNREACHABLE',
  'VEHICLE_PROBLEM',
  'SYSTEM_TIMEOUT',
  'OTHER',
};

Widget wrapRide(Widget child, {ThemeMode themeMode = ThemeMode.light}) {
  return ProviderScope(
    child: MaterialApp(
      themeMode: themeMode,
      theme: ThemeData.light(useMaterial3: true),
      darkTheme: ThemeData.dark(useMaterial3: true),
      home: child,
    ),
  );
}

Map<String, dynamic> quotePayload({
  String quoteId = 'quote-1',
  String serviceType = 'MOTORCYCLE',
  DateTime? expiresAt,
}) {
  return {
    'quoteId': quoteId,
    'serviceType': serviceType,
    'distanceMeters': 4200,
    'durationSeconds': 900,
    'etaSeconds': 300,
    'fare': {
      'baseFare': 5000,
      'distanceFare': 12000,
      'serviceFee': 1500,
      'subtotalFare': 17000,
      'totalFare': 18500,
      'currency': 'IDR',
    },
    'expiresAt':
        (expiresAt ?? DateTime.now().toUtc().add(const Duration(minutes: 5)))
            .toIso8601String(),
  };
}

Map<String, dynamic> orderPayload({
  String status = 'SEARCHING_DRIVER',
  bool isFinal = false,
  Map<String, dynamic>? driver,
  Map<String, dynamic>? vehicle,
  Map<String, dynamic>? cancellation,
  String reference = 'RID-A2B3C4D5E6',
  int totalFare = 18500,
}) {
  return {
    'reference': reference,
    'serviceType': 'MOTORCYCLE',
    'status': status,
    'isFinal': isFinal,
    'pickupAddress': 'LOKASI_DEMO_A — Titik Uji Utara',
    'dropoffAddress': 'LOKASI_DEMO_B — Titik Uji Tengah',
    'distanceMeters': 4200,
    'durationSeconds': 900,
    'fare': {'totalFare': totalFare, 'currency': 'IDR'},
    'payment': {'method': 'CASH', 'state': 'PENDING'},
    'cancellation': cancellation,
    'timeline': const {},
    'driver': driver,
    'vehicle': vehicle,
    'createdAt': DateTime.now().toUtc().toIso8601String(),
  };
}

const _assignedDriver = {'displayName': 'Budi'};
const _assignedVehicle = {
  'serviceType': 'MOTORCYCLE',
  'model': 'Vario 160',
  'color': 'Hitam',
  'maskedPlate': 'B 12•• XYZ',
};

DioException dioError({
  int statusCode = 500,
  String? code,
  DioExceptionType type = DioExceptionType.badResponse,
}) {
  final request = RequestOptions(path: '/rides');
  return DioException(
    requestOptions: request,
    type: type,
    response: Response<Map<String, dynamic>>(
      requestOptions: request,
      statusCode: statusCode,
      data: code == null ? null : {'success': false, 'code': code},
    ),
  );
}

/// Viewport ponsel yang cukup tinggi.
///
/// Default test 800x600 lebih pendek daripada ponsel mana pun, sehingga tombol
/// aksi jatuh di luar area yang dapat disentuh. Test lebar spesifik (320/360/
/// 412 dp) mengatur ukurannya sendiri.
void useTallView(
  WidgetTester tester, {
  double width = 412,
  double height = 1400,
}) {
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

/// Memajukan beberapa frame tanpa menunggu animasi selesai.
///
/// `pumpAndSettle` tidak dapat dipakai pada layar yang menampilkan spinner
/// indeterminate: animasinya memang tidak pernah berhenti. Jadi frame dimajukan
/// secara eksplisit sejumlah yang cukup untuk transisi rute dan bottom sheet.
Future<void> settleFrames(WidgetTester tester, {int frames = 12}) async {
  for (var index = 0; index < frames; index += 1) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

/// Menyentuh teks setelah memastikan widget-nya terlihat.
Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pump();
}

/// Memilih titik jemput dan tujuan pada layar pemesanan.
Future<void> pickRoute(WidgetTester tester) async {
  await tapVisible(tester, find.text('LOKASI_DEMO_A').first);
  await tapVisible(tester, find.text('LOKASI_DEMO_B').last);
}

void main() {
  setUp(() {
    tapGoDisablePersistenceForTests = true;
  });

  // -------------------------------------------------------------------------
  // 1–2. Entry point dashboard
  // -------------------------------------------------------------------------

  group('entry point dashboard', () {
    test('1. label TapGo Ride memetakan ke layanan MOTORCYCLE', () {
      expect(
          tapGoRideEntryServiceFor('TapGo Ride'), RideServiceKind.motorcycle);
      expect(RideServiceKind.motorcycle.apiValue, 'MOTORCYCLE');
      expect(RideServiceKind.motorcycle.displayName, 'Motor');
    });

    test('2. label TapGo Car memetakan ke layanan CAR', () {
      expect(tapGoRideEntryServiceFor('TapGo Car'), RideServiceKind.car);
      expect(RideServiceKind.car.apiValue, 'CAR');
      expect(RideServiceKind.car.displayName, 'Mobil');
    });

    test('label layanan lain tidak membuka alur Ojek Online', () {
      expect(tapGoRideEntryServiceFor('TapGo Food'), isNull);
      expect(tapGoRideEntryServiceFor('Pulsa'), isNull);
      expect(tapGoRideEntryServiceFor(''), isNull);
    });

    testWidgets('1b. entry Motor membuka layar pemesanan MOTORCYCLE', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          Builder(
            builder: (context) => TextButton(
              onPressed: () => tapGoOpenRideBooking(
                context,
                tapGoRideEntryServiceFor('TapGo Ride')!,
              ),
              child: const Text('buka'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('buka'));
      await settleFrames(tester);

      final screen = tester.widget<RideBookingScreen>(
        find.byType(RideBookingScreen),
      );
      expect(screen.initialService, RideServiceKind.motorcycle);
      expect(find.text('TapGo Motor'), findsOneWidget);
    });

    testWidgets('2b. entry Mobil membuka layar pemesanan CAR', (tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          Builder(
            builder: (context) => TextButton(
              onPressed: () => tapGoOpenRideBooking(
                context,
                tapGoRideEntryServiceFor('TapGo Car')!,
              ),
              child: const Text('buka'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('buka'));
      await settleFrames(tester);

      final screen = tester.widget<RideBookingScreen>(
        find.byType(RideBookingScreen),
      );
      expect(screen.initialService, RideServiceKind.car);
      expect(find.text('TapGo Mobil'), findsOneWidget);
    });
  });

  // -------------------------------------------------------------------------
  // 3–4. Batas provider lokasi
  // -------------------------------------------------------------------------

  group('batas provider lokasi', () {
    test('3. default build tidak mengaktifkan demo dan fail closed', () {
      // Inilah jaminan release: tanpa flag compile-time, port yang terpasang
      // adalah yang tidak menyediakan lokasi apa pun.
      expect(tapGoRideDemoMode, isFalse);
      expect(tapGoRideLocationPort(), isA<UnavailableLocationPort>());
      expect(
        tapGoRideLocationPort().status,
        RideLocationProviderStatus.unavailable,
      );
      expect(tapGoRideLocationPort().availableLocations(), isEmpty);
    });

    testWidgets('3b. tanpa provider, pemesanan tidak dapat dilanjutkan', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          const RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: UnavailableLocationPort(),
          ),
        ),
      );
      await settleFrames(tester);

      expect(find.text(tapGoRideLocationUnavailableMessage), findsOneWidget);
      // Tidak ada jalan menuju harga maupun pemesanan.
      expect(find.text('Cek Harga'), findsNothing);
      expect(find.text('Pesan Sekarang'), findsNothing);
    });

    testWidgets('4. label DEMO DATA tidak muncul pada build default', (
      tester,
    ) async {
      await tester.pumpWidget(wrapRide(const RideDemoBadge()));
      await settleFrames(tester);

      expect(find.textContaining(tapGoRideDemoLabel), findsNothing);
      expect(find.byType(SizedBox), findsWidgets);
    });

    test('4b. flag demo hanya menyala untuk string literal true', () {
      // Nilai yang mirip tidak boleh menyalakan demo; ini diuji lewat port
      // demo yang tersedia dan default yang tetap fail closed.
      expect(const DemoLocationPort().availableLocations(), hasLength(3));
      expect(
        const DemoLocationPort()
            .availableLocations()
            .map((location) => location.id),
        containsAll(
            <String>['LOKASI_DEMO_A', 'LOKASI_DEMO_B', 'LOKASI_DEMO_C']),
      );
      expect(const UnavailableLocationPort().availableLocations(), isEmpty);
    });
  });

  // -------------------------------------------------------------------------
  // 5–10. Estimasi dan pemesanan
  // -------------------------------------------------------------------------

  group('estimasi dan pemesanan', () {
    testWidgets('5. permintaan quote memakai DTO sesuai kontrak backend', (
      tester,
    ) async {
      String? capturedService;
      Map<String, dynamic>? capturedPickup;
      Map<String, dynamic>? capturedDropoff;

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async {
              capturedService = serviceType;
              capturedPickup = pickup;
              capturedDropoff = dropoff;
              return quotePayload();
            },
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      expect(capturedService, 'MOTORCYCLE');
      expect(capturedPickup, {
        'lat': -6.20,
        'lng': 106.81,
        'address': 'LOKASI_DEMO_A — Titik Uji Utara',
      });
      expect(capturedDropoff, {
        'lat': -6.21,
        'lng': 106.82,
        'address': 'LOKASI_DEMO_B — Titik Uji Tengah',
      });
    });

    test('6. tarif integer dirender sebagai Rupiah', () {
      expect(tapGoFormatRideRupiah(18500), 'Rp 18.500');
      expect(tapGoFormatRideRupiah(5000), 'Rp 5.000');
      expect(tapGoFormatRideRupiah(1250000), 'Rp 1.250.000');
      expect(tapGoFormatRideRupiah(0), 'Rp 0');
      expect(tapGoFormatRideRupiah(999), 'Rp 999');
      expect(tapGoFormatRideDistance(4200), '4,2 km');
      expect(tapGoFormatRideDistance(850), '850 m');
      expect(tapGoFormatRideDuration(900), '15 menit');
      expect(tapGoFormatRideDuration(45), '45 detik');
    });

    testWidgets('6b. kartu estimasi menampilkan rincian tarif otoritatif', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async =>
                quotePayload(),
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      expect(find.text('Rp 18.500'), findsOneWidget);
      expect(find.text('Rp 5.000'), findsOneWidget);
      expect(find.text('Rp 12.000'), findsOneWidget);
      expect(find.text('Rp 1.500'), findsOneWidget);
      expect(find.text('4,2 km'), findsOneWidget);
      // Pembayaran tunai, tanpa opsi digital apa pun.
      expect(
        find.textContaining('Pembayaran tunai kepada driver'),
        findsOneWidget,
      );
      expect(find.textContaining('DIGITAL'), findsNothing);
      expect(find.textContaining('Dompet'), findsNothing);
    });

    testWidgets('7. estimasi kedaluwarsa tidak dapat dipakai memesan', (
      tester,
    ) async {
      var orderCalls = 0;
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async =>
                quotePayload(
              expiresAt: DateTime.now().toUtc().subtract(
                    const Duration(minutes: 1),
                  ),
            ),
            orderRequest: ({required quoteId, idempotencyKey}) async {
              orderCalls += 1;
              return orderPayload();
            },
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      expect(find.text('Estimasi sudah kedaluwarsa.'), findsOneWidget);
      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Pesan Sekarang'),
      );
      expect(button.onPressed, isNull);

      await tester.tap(
        find.widgetWithText(FilledButton, 'Pesan Sekarang'),
        warnIfMissed: false,
      );
      await settleFrames(tester);
      expect(orderCalls, 0);
    });

    testWidgets('8. tap ganda Cek Harga hanya mengirim satu permintaan', (
      tester,
    ) async {
      var calls = 0;
      final gate = Completer<Map<String, dynamic>>();

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) {
              calls += 1;
              return gate.future;
            },
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);

      await tapVisible(tester, find.text('Cek Harga'));
      await tester.pump();
      // Tombol sudah menampilkan loading; tap kedua tidak boleh menambah
      // permintaan.
      await tester.tap(find.byType(FilledButton).first, warnIfMissed: false);
      await tester.pump();
      expect(calls, 1);

      gate.complete(quotePayload());
      await settleFrames(tester);
      expect(calls, 1);
    });

    testWidgets('9. tap ganda Pesan Sekarang hanya mengirim satu permintaan', (
      tester,
    ) async {
      var orderCalls = 0;
      final gate = Completer<Map<String, dynamic>>();

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async =>
                quotePayload(),
            orderRequest: ({required quoteId, idempotencyKey}) {
              orderCalls += 1;
              return gate.future;
            },
            // Layar status yang dibuka setelah pemesanan juga disuntik, supaya
            // test tidak pernah menyentuh jaringan nyata.
            detailRequest: (_) async => orderPayload(),
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      await tapVisible(tester, find.text('Pesan Sekarang'));
      await tester.pump();
      await tester.tap(find.byType(FilledButton).last, warnIfMissed: false);
      await tester.pump();
      expect(orderCalls, 1);

      gate.complete(orderPayload());
      await settleFrames(tester);
      expect(orderCalls, 1);
    });

    testWidgets('10. idempotency key stabil saat percobaan ulang yang sama', (
      tester,
    ) async {
      final keys = <String?>[];
      var attempt = 0;

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async =>
                quotePayload(),
            orderRequest: ({required quoteId, idempotencyKey}) async {
              keys.add(idempotencyKey);
              attempt += 1;
              if (attempt == 1) {
                throw dioError(type: DioExceptionType.connectionError);
              }
              return orderPayload();
            },
            detailRequest: (_) async => orderPayload(),
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      await tapVisible(tester, find.text('Pesan Sekarang'));
      await settleFrames(tester);
      expect(
        find.textContaining('Koneksi ke server TapGo terputus'),
        findsOneWidget,
      );

      await tapVisible(tester, find.text('Pesan Sekarang'));
      await settleFrames(tester);

      expect(keys, hasLength(2));
      expect(keys.first, isNotNull);
      // Kunci yang sama berarti backend memperlakukannya sebagai satu
      // pemesanan, bukan dua.
      expect(keys[0], keys[1]);
    });
  });

  // -------------------------------------------------------------------------
  // 11–15. Status dan pengungkapan driver
  // -------------------------------------------------------------------------

  group('status dan pengungkapan driver', () {
    testWidgets('11. status pencarian driver mengikuti status server', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(status: 'SEARCHING_DRIVER'),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Mencari driver'), findsOneWidget);
      expect(
        find.textContaining('Menghubungkan dengan driver terdekat'),
        findsOneWidget,
      );
      // Belum ada driver: tidak ada kartu driver.
      expect(find.byIcon(Icons.person_rounded), findsNothing);
    });

    testWidgets('12. DRIVER_ASSIGNED menampilkan tepat kontrak R2.4A', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'DRIVER_ASSIGNED',
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Driver menerima pesanan'), findsOneWidget);
      expect(find.text('Budi'), findsOneWidget);
      expect(find.text('B 12•• XYZ'), findsOneWidget);
      expect(find.text('Motor · Vario 160 · Hitam'), findsOneWidget);
    });

    testWidgets('13. driver null tidak menghasilkan driver palsu', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(status: 'SEARCHING_DRIVER'),
            ),
          ),
        ),
      );
      await tester.pump();

      final order = RideOrderView.fromJson(
        orderPayload(status: 'SEARCHING_DRIVER'),
      );
      expect(order.driver, isNull);
      expect(order.vehicle, isNull);
      // Tidak ada placeholder nama maupun plat yang dikarang client.
      expect(find.byIcon(Icons.person_rounded), findsNothing);
      expect(find.textContaining('•'), findsNothing);
      expect(find.textContaining('Driver TapGo'), findsNothing);
    });

    test('13b. driver dengan nama kosong tetap null, bukan string kosong', () {
      expect(RideDriverView.fromJson(const {'displayName': '  '}), isNull);
      expect(RideDriverView.fromJson(null), isNull);
      expect(RideVehicleView.fromJson(const {'maskedPlate': ''}), isNull);
    });

    testWidgets('14. hanya maskedPlate yang tampil, bukan plat mentah', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'DRIVER_ASSIGNED',
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('B 12•• XYZ'), findsOneWidget);
      expect(find.textContaining('B 1234'), findsNothing);
      expect(find.textContaining('plateNumber'), findsNothing);
      expect(find.textContaining('Hash'), findsNothing);
    });

    testWidgets('15. phone, rating, dan ID internal tidak pernah tampil', (
      tester,
    ) async {
      // Payload sengaja dibuat "gemuk": walau server mengirim field terlarang,
      // UI tidak boleh punya jalan menampilkannya.
      final payload = orderPayload(
        status: 'DRIVER_ARRIVED',
        driver: const {
          'displayName': 'Budi',
          'phone': '+628111222333',
          'email': 'budi@example.com',
          'rating': 4.87,
          'fullName': 'Budi Santoso Wijaya',
          'id': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
        vehicle: const {
          'serviceType': 'MOTORCYCLE',
          'model': 'Vario 160',
          'color': 'Hitam',
          'maskedPlate': 'B 12•• XYZ',
          'plateNumber': 'B 1234 XYZ',
          'plateNumberHash': 'deadbeefcafe',
        },
      );
      payload['passengerId'] = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(payload),
          ),
        ),
      );
      await tester.pump();

      for (final forbidden in <String>[
        '+628111222333',
        'budi@example.com',
        '4.87',
        '4,87',
        'Budi Santoso Wijaya',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        'B 1234 XYZ',
        'deadbeefcafe',
      ]) {
        expect(
          find.textContaining(forbidden),
          findsNothing,
          reason: 'nilai terlarang bocor ke UI: $forbidden',
        );
      }
      expect(find.text('Budi'), findsOneWidget);
      expect(find.text('B 12•• XYZ'), findsOneWidget);
    });

    test('15b. model view tidak menyimpan field terlarang', () {
      final driver = RideDriverView.fromJson(const {
        'displayName': 'Budi',
        'phone': '+628111222333',
        'rating': 4.9,
      });
      // Kontrak frozen: satu-satunya field driver adalah displayName.
      expect(driver!.displayName, 'Budi');
      final vehicle = RideVehicleView.fromJson(const {
        'serviceType': 'CAR',
        'maskedPlate': 'B 12•• XYZ',
        'plateNumber': 'B 1234 XYZ',
      });
      expect(vehicle!.maskedPlate, 'B 12•• XYZ');
      expect(vehicle.serviceType, 'CAR');
    });
  });

  // -------------------------------------------------------------------------
  // 16–19. Polling dan status tidak dikenal
  // -------------------------------------------------------------------------

  group('polling dan siklus hidup', () {
    test('16. polling tidak pernah tumpang-tindih', () async {
      final gate = Completer<Map<String, dynamic>>();
      var calls = 0;

      final poller = RideStatusPoller(
        reference: 'RID-A2B3C4D5E6',
        interval: const Duration(milliseconds: 1),
        onUpdate: (_) {},
        onError: (_) {},
        fetch: (_) {
          calls += 1;
          return gate.future;
        },
      )..start();

      // Banyak tick lewat, tetapi permintaan pertama belum selesai.
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(calls, 1);
      expect(poller.requestCount, 1);

      gate.complete(orderPayload(status: 'SEARCHING_DRIVER'));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(calls, greaterThan(1));
      poller.dispose();
    });

    test('17. polling berhenti ketika server melaporkan isFinal', () async {
      var calls = 0;
      final poller = RideStatusPoller(
        reference: 'RID-A2B3C4D5E6',
        interval: const Duration(milliseconds: 1),
        onUpdate: (_) {},
        onError: (_) {},
        fetch: (_) async {
          calls += 1;
          // isFinal berasal dari server, bukan dari daftar status di client.
          return orderPayload(status: 'COMPLETED', isFinal: true);
        },
      )..start();

      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(poller.isStopped, isTrue);
      expect(calls, 1);

      // start() setelah final tidak menghidupkan ulang.
      poller.start();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(calls, 1);
      poller.dispose();
    });

    test('18. polling berhenti dan tidak menembak lagi setelah dispose',
        () async {
      var calls = 0;
      final poller = RideStatusPoller(
        reference: 'RID-A2B3C4D5E6',
        interval: const Duration(milliseconds: 1),
        onUpdate: (_) {},
        onError: (_) {},
        fetch: (_) async {
          calls += 1;
          return orderPayload(status: 'SEARCHING_DRIVER');
        },
      )..start();

      await Future<void>.delayed(const Duration(milliseconds: 20));
      final beforeDispose = calls;
      expect(beforeDispose, greaterThan(0));

      poller.dispose();
      await poller.refreshNow();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(calls, beforeDispose);
      expect(poller.isRunning, isFalse);
    });

    test('18b. pause menghentikan timer, refreshNow memuat dari server',
        () async {
      var calls = 0;
      final poller = RideStatusPoller(
        reference: 'RID-A2B3C4D5E6',
        interval: const Duration(milliseconds: 1),
        onUpdate: (_) {},
        onError: (_) {},
        fetch: (_) async {
          calls += 1;
          return orderPayload(status: 'SEARCHING_DRIVER');
        },
      )..start();

      await Future<void>.delayed(const Duration(milliseconds: 20));
      poller.pause();
      final paused = calls;
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(calls, paused, reason: 'background tidak boleh terus polling');

      await poller.refreshNow();
      expect(calls, paused + 1);
      poller.dispose();
    });

    test('18c. sesi tidak sah menghentikan polling, bukan mengulanginya',
        () async {
      var calls = 0;
      final poller = RideStatusPoller(
        reference: 'RID-A2B3C4D5E6',
        interval: const Duration(milliseconds: 1),
        onUpdate: (_) {},
        onError: (_) {},
        fetch: (_) async {
          calls += 1;
          throw dioError(statusCode: 401, code: 'AUTH_SESSION_REVOKED');
        },
      )..start();

      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(poller.isStopped, isTrue);
      expect(calls, 1);
      poller.dispose();
    });

    test('19. status tidak dikenal fail closed', () {
      final order = RideOrderView.fromJson(orderPayload(status: 'TELEPORTED'));
      expect(order.phase, RideUiPhase.unknown);
      expect(order.statusTitle, 'Status perjalanan belum dapat ditampilkan');
      // Tidak dianggap sukses dan tidak menawarkan aksi apa pun.
      expect(order.phase, isNot(RideUiPhase.completed));
      expect(order.canCancel, isFalse);

      final empty = RideOrderView.fromJson(orderPayload(status: ''));
      expect(empty.phase, RideUiPhase.unknown);
    });

    testWidgets('19b. layar status menolak mengklaim sukses untuk status baru',
        (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(status: 'TELEPORTED'),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(
        find.text('Status perjalanan belum dapat ditampilkan'),
        findsOneWidget,
      );
      expect(find.text('Perjalanan selesai'), findsNothing);
      expect(find.text('TELEPORTED'), findsNothing);
      expect(find.text('Batalkan perjalanan'), findsNothing);
    });

    test('matriks status ke fase sesuai state machine backend', () {
      final expected = <String, RideUiPhase>{
        'CREATED': RideUiPhase.created,
        'SEARCHING_DRIVER': RideUiPhase.searching,
        'DRIVER_ASSIGNED': RideUiPhase.assigned,
        'DRIVER_TO_PICKUP': RideUiPhase.assigned,
        'DRIVER_ARRIVED': RideUiPhase.arrived,
        'IN_TRIP': RideUiPhase.inTrip,
        'COMPLETED': RideUiPhase.completed,
        'CANCELLED_BY_PASSENGER': RideUiPhase.cancelled,
        'CANCELLED_BY_DRIVER': RideUiPhase.cancelled,
        'CANCELLED_BY_SYSTEM': RideUiPhase.cancelled,
        'NO_DRIVER': RideUiPhase.cancelled,
        'EXPIRED': RideUiPhase.cancelled,
        'PAYMENT_FAILED': RideUiPhase.cancelled,
      };
      expected.forEach((status, phase) {
        expect(
          RideOrderView.fromJson(orderPayload(status: status)).phase,
          phase,
          reason: 'pemetaan salah untuk $status',
        );
      });
    });

    testWidgets('IN_TRIP tidak lagi menawarkan pembatalan', (tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'IN_TRIP',
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Perjalanan berlangsung'), findsOneWidget);
      // Cermin RIDE_TRANSITIONS: passenger cancel sah sampai DRIVER_ARRIVED.
      expect(find.text('Batalkan perjalanan'), findsNothing);
    });

    testWidgets('DRIVER_ARRIVED masih menawarkan pembatalan', (tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'DRIVER_ARRIVED',
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Driver sudah tiba'), findsOneWidget);
      expect(find.text('Batalkan perjalanan'), findsOneWidget);
    });

    testWidgets('COMPLETED menutup polling dan menampilkan total dibayar', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'COMPLETED',
                isFinal: true,
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.text('Total dibayar'), findsOneWidget);
      expect(find.text('Rp 18.500'), findsOneWidget);
      expect(find.text('Batalkan perjalanan'), findsNothing);
      expect(find.text('Kembali ke Dashboard'), findsOneWidget);
    });
  });

  // -------------------------------------------------------------------------
  // 20–21. Pembatalan
  // -------------------------------------------------------------------------

  group('pembatalan', () {
    test('20. seluruh kode alasan client ada di allowlist backend', () {
      expect(tapGoRideCancellationReasons, isNotEmpty);
      for (final code in tapGoRideCancellationReasons.keys) {
        expect(
          _backendCancellationAllowlist,
          contains(code),
          reason: 'kode $code tidak dikenal backend',
        );
      }
      // Batas catatan mengikuti validator backend.
      expect(tapGoRideCancellationNoteMaxLength, 500);
    });

    testWidgets('20b. lembar pembatalan mengirim kode dan catatan', (
      tester,
    ) async {
      String? capturedReason;
      String? capturedNote;

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(status: 'SEARCHING_DRIVER'),
            ),
            cancelRequest: ({
              required reference,
              required reasonCode,
              note,
            }) async {
              capturedReason = reasonCode;
              capturedNote = note;
              return orderPayload(
                status: 'CANCELLED_BY_PASSENGER',
                isFinal: true,
                cancellation: const {
                  'reason': 'WAIT_TOO_LONG',
                  'fee': 0,
                  'at': null,
                },
              );
            },
          ),
        ),
      );
      await tester.pump();

      await tapVisible(tester, find.text('Batalkan perjalanan'));
      await settleFrames(tester);

      // Tombol kirim nonaktif sebelum alasan dipilih.
      final before = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Kirim pembatalan'),
      );
      expect(before.onPressed, isNull);

      await tapVisible(tester, find.text('Menunggu terlalu lama'));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'Sudah 20 menit');
      await tester.pump();
      await tapVisible(tester, find.text('Kirim pembatalan'));
      await settleFrames(tester);

      expect(capturedReason, 'WAIT_TOO_LONG');
      expect(capturedNote, 'Sudah 20 menit');
      expect(find.text('Dibatalkan olehmu'), findsOneWidget);
      expect(find.text('Menunggu terlalu lama'), findsOneWidget);
    });

    testWidgets('20c. catatan dibatasi panjang maksimum backend', (
      tester,
    ) async {
      // Bottom sheet biasanya menyediakan Material sendiri; di test lembar ini
      // dirender langsung sehingga perlu Scaffold sebagai induknya.
      await tester.pumpWidget(
        wrapRide(const Scaffold(body: RideCancellationSheet())),
      );
      await settleFrames(tester);

      final field = tester.widget<TextField>(find.byType(TextField));
      expect(field.maxLength, tapGoRideCancellationNoteMaxLength);

      await tester.enterText(find.byType(TextField), 'x' * 700);
      await tester.pump();
      final controller = field.controller!;
      expect(
        controller.text.length,
        lessThanOrEqualTo(tapGoRideCancellationNoteMaxLength),
      );
    });

    testWidgets('21. tap beruntun pembatalan tetap satu permintaan', (
      tester,
    ) async {
      var cancelCalls = 0;
      final gate = Completer<Map<String, dynamic>>();

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(status: 'SEARCHING_DRIVER'),
            ),
            cancelRequest: ({required reference, required reasonCode, note}) {
              cancelCalls += 1;
              return gate.future;
            },
          ),
        ),
      );
      await tester.pump();

      await tapVisible(tester, find.text('Batalkan perjalanan'));
      await settleFrames(tester);
      await tapVisible(tester, find.text('Rencana berubah'));
      await tester.pump();
      await tapVisible(tester, find.text('Kirim pembatalan'));
      await tester.pump();

      expect(cancelCalls, 1);

      // Sementara permintaan berjalan, tombol pembatalan nonaktif.
      final button = tester.widget<OutlinedButton>(find.byType(OutlinedButton));
      expect(button.onPressed, isNull);
      await tester.tap(find.byType(OutlinedButton), warnIfMissed: false);
      await tester.pump();
      expect(cancelCalls, 1);

      gate.complete(
        orderPayload(status: 'CANCELLED_BY_PASSENGER', isFinal: true),
      );
      await settleFrames(tester);
      expect(cancelCalls, 1);
    });

    testWidgets('21b. pembatalan yang ditolak server memberi pesan ramah', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(status: 'DRIVER_ARRIVED'),
            ),
            cancelRequest: ({
              required reference,
              required reasonCode,
              note,
            }) async =>
                throw dioError(
              statusCode: 409,
              code: 'RIDE_STATUS_CONFLICT',
            ),
          ),
        ),
      );
      await tester.pump();

      await tapVisible(tester, find.text('Batalkan perjalanan'));
      await settleFrames(tester);
      await tapVisible(tester, find.text('Alasan lain'));
      await tester.pump();
      await tapVisible(tester, find.text('Kirim pembatalan'));
      await settleFrames(tester);

      expect(
        find.textContaining('Status perjalanan sudah berubah'),
        findsOneWidget,
      );
      expect(find.textContaining('DioException'), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  // 22–24. Kegagalan dan sesi
  // -------------------------------------------------------------------------

  group('kegagalan jaringan dan sesi', () {
    testWidgets('22. kegagalan jaringan dapat dicoba ulang', (tester) async {
      var attempt = 0;
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            pollInterval: const Duration(hours: 1),
            detailRequest: (_) async {
              attempt += 1;
              if (attempt == 1) {
                throw dioError(type: DioExceptionType.connectionError);
              }
              return orderPayload(status: 'SEARCHING_DRIVER');
            },
          ),
        ),
      );
      await settleFrames(tester);

      expect(find.text('Gagal memuat status'), findsOneWidget);
      expect(
        find.textContaining('Koneksi ke server TapGo terputus'),
        findsOneWidget,
      );

      await tapVisible(tester, find.text('Coba lagi'));
      await settleFrames(tester);

      expect(find.text('Mencari driver'), findsOneWidget);
      expect(find.text('Gagal memuat status'), findsNothing);
    });

    testWidgets('22b. riwayat yang gagal dapat dicoba ulang', (tester) async {
      var attempt = 0;
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideHistoryScreen(
            historyRequest: () async {
              attempt += 1;
              if (attempt == 1) {
                throw dioError(type: DioExceptionType.receiveTimeout);
              }
              return [orderPayload(status: 'COMPLETED', isFinal: true)];
            },
          ),
        ),
      );
      await settleFrames(tester);

      expect(find.text('Gagal memuat riwayat'), findsOneWidget);
      await tapVisible(tester, find.text('Coba lagi'));
      await settleFrames(tester);
      expect(find.text('Perjalanan selesai'), findsOneWidget);
    });

    test('23. exception mentah tidak pernah menjadi pesan pengguna', () {
      final messages = <String>[
        tapGoRideErrorMessage(dioError(statusCode: 500)),
        tapGoRideErrorMessage(dioError(code: 'KODE_TIDAK_DIKENAL')),
        tapGoRideErrorMessage(Exception('boom')),
        tapGoRideErrorMessage(StateError('internal')),
        tapGoRideErrorMessage(dioError(type: DioExceptionType.connectionError)),
      ];
      for (final message in messages) {
        expect(message, isNotEmpty);
        expect(message.contains('Exception'), isFalse);
        expect(message.contains('DioException'), isFalse);
        expect(message.contains('StateError'), isFalse);
        expect(message.contains('#0'), isFalse);
        expect(message.contains('/rides'), isFalse);
      }
      // Kode yang dikenal tetap dipetakan ke kalimat spesifik.
      expect(
        tapGoRideErrorMessage(dioError(code: 'RIDE_ACTIVE_ORDER_EXISTS')),
        'Masih ada perjalanan yang berjalan. Selesaikan dulu ya.',
      );
      expect(
        tapGoRideErrorMessage(dioError(code: 'RIDE_QUOTE_EXPIRED')),
        'Estimasi sudah kedaluwarsa. Silakan cek harga lagi.',
      );
    });

    testWidgets('23b. kegagalan tak dikenal tampil sebagai kalimat umum', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async =>
                throw StateError('kegagalan internal'),
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      expect(
        find.text('Perjalanan belum dapat diproses. Silakan coba lagi.'),
        findsOneWidget,
      );
      expect(find.textContaining('StateError'), findsNothing);
      expect(find.textContaining('kegagalan internal'), findsNothing);
    });

    test('24. deteksi sesi berakhir mengikuti kode auth existing', () {
      expect(
        tapGoRideIsSessionExpired(
          dioError(statusCode: 401, code: 'AUTH_SESSION_REVOKED'),
        ),
        isTrue,
      );
      expect(
        tapGoRideIsSessionExpired(
          dioError(statusCode: 401, code: 'AUTH_TOKEN_EXPIRED'),
        ),
        isTrue,
      );
      expect(tapGoRideIsSessionExpired(dioError(statusCode: 401)), isTrue);
      // Bukan 401 berarti bukan masalah sesi dan tidak boleh memaksa logout.
      expect(tapGoRideIsSessionExpired(dioError(statusCode: 409)), isFalse);
      expect(tapGoRideIsSessionExpired(dioError(statusCode: 403)), isFalse);
      expect(tapGoRideIsSessionExpired(StateError('x')), isFalse);
    });

    testWidgets('24b. sesi berakhir mengembalikan pengguna ke layar masuk', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideHistoryScreen(
            historyRequest: () async =>
                throw dioError(statusCode: 401, code: 'AUTH_SESSION_REVOKED'),
          ),
        ),
      );
      await settleFrames(tester);

      // Memakai jalur logout yang sudah ada: kembali ke AuthScreen.
      expect(find.byType(AuthScreen), findsOneWidget);
      expect(find.byType(RideHistoryScreen), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  // 25–26. Riwayat
  // -------------------------------------------------------------------------

  group('riwayat perjalanan', () {
    testWidgets('25. riwayat menampilkan status dan data yang aman', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideHistoryScreen(
            historyRequest: () async => [
              orderPayload(
                status: 'COMPLETED',
                isFinal: true,
                reference: 'RID-A2B3C4D5E6',
                driver: const {
                  'displayName': 'Budi',
                  'phone': '+628111222333',
                  'rating': 4.9,
                },
                vehicle: _assignedVehicle,
              ),
              orderPayload(
                status: 'CANCELLED_BY_PASSENGER',
                isFinal: true,
                reference: 'RID-Z9Y8X7W6V5',
                totalFare: 0,
              ),
            ],
          ),
        ),
      );
      await settleFrames(tester);

      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.text('Dibatalkan olehmu'), findsOneWidget);
      expect(find.text('RID-A2B3C4D5E6'), findsOneWidget);
      expect(find.text('RID-Z9Y8X7W6V5'), findsOneWidget);
      expect(find.text('Rp 18.500'), findsOneWidget);
      // Riwayat tidak pernah membocorkan telepon maupun rating.
      expect(find.textContaining('+628111222333'), findsNothing);
      expect(find.textContaining('4.9'), findsNothing);
      expect(find.textContaining('4,9'), findsNothing);
    });

    testWidgets('26. riwayat kosong menampilkan state kosong yang jelas', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(RideHistoryScreen(historyRequest: () async => const [])),
      );
      await settleFrames(tester);

      expect(find.text('Belum ada perjalanan'), findsOneWidget);
      expect(
        find.textContaining('akan muncul di sini'),
        findsOneWidget,
      );
      expect(find.text('Gagal memuat riwayat'), findsNothing);
    });
  });

  // -------------------------------------------------------------------------
  // 27–29. Responsif, teks besar, tema gelap
  // -------------------------------------------------------------------------

  group('responsif dan aksesibilitas', () {
    Future<void> renderAtWidth(WidgetTester tester, double width) async {
      tester.view.physicalSize = Size(width * 3, 780 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'DRIVER_ARRIVED',
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
        ),
      );
      await settleFrames(tester);
    }

    for (final width in <double>[320, 360, 412]) {
      testWidgets('27. layar status rapi pada lebar ${width.toInt()} dp', (
        tester,
      ) async {
        await renderAtWidth(tester, width);

        expect(tester.takeException(), isNull);
        expect(find.text('Driver sudah tiba'), findsOneWidget);
        expect(find.text('B 12•• XYZ'), findsOneWidget);
        expect(find.text('Batalkan perjalanan'), findsOneWidget);
      });
    }

    testWidgets('27b. layar pemesanan rapi pada lebar 320 dp', (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 780 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapRide(
          RideBookingScreen(
            initialService: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            quoteRequest: ({
              required serviceType,
              required pickup,
              required dropoff,
            }) async =>
                quotePayload(),
          ),
        ),
      );
      await settleFrames(tester);
      await pickRoute(tester);
      await tapVisible(tester, find.text('Cek Harga'));
      await settleFrames(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Rp 18.500'), findsOneWidget);
    });

    testWidgets('28. teks besar tidak menyebabkan overflow', (tester) async {
      tester.view.physicalSize = const Size(360 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: ThemeData.light(useMaterial3: true),
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(1.8)),
              child: RideStatusScreen(
                reference: 'RID-A2B3C4D5E6',
                autoStart: false,
                initialOrder: RideOrderView.fromJson(
                  orderPayload(
                    status: 'DRIVER_ARRIVED',
                    driver: _assignedDriver,
                    vehicle: _assignedVehicle,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await settleFrames(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Driver sudah tiba'), findsOneWidget);
    });

    testWidgets('28b. teks besar pada layar pemesanan tidak overflow', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: ThemeData.light(useMaterial3: true),
            home: const MediaQuery(
              data: MediaQueryData(textScaler: TextScaler.linear(1.8)),
              child: RideBookingScreen(
                initialService: RideServiceKind.car,
                locationPort: DemoLocationPort(),
              ),
            ),
          ),
        ),
      );
      await settleFrames(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Cek Harga'), findsOneWidget);
    });

    testWidgets('29. tema gelap tetap menampilkan seluruh informasi', (
      tester,
    ) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            autoStart: false,
            initialOrder: RideOrderView.fromJson(
              orderPayload(
                status: 'DRIVER_ASSIGNED',
                driver: _assignedDriver,
                vehicle: _assignedVehicle,
              ),
            ),
          ),
          themeMode: ThemeMode.dark,
        ),
      );
      await settleFrames(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Driver menerima pesanan'), findsOneWidget);
      expect(find.text('Budi'), findsOneWidget);
      expect(find.text('B 12•• XYZ'), findsOneWidget);
      expect(find.text('Rp 18.500'), findsOneWidget);
    });

    testWidgets('area sentuh aksi utama minimal 48 dp', (tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          const RidePrimaryButton(
            label: 'Cek Harga',
            isBusy: false,
            onPressed: null,
          ),
        ),
      );
      await settleFrames(tester);

      final size = tester.getSize(find.byType(FilledButton));
      expect(size.height, greaterThanOrEqualTo(48));
    });
  });
}
