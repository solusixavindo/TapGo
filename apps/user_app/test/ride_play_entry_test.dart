import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Regression Stage R2.4R: entry point Ojek Online pada distribusi Play, dan
/// pemulihan perjalanan aktif dari server.
///
/// Build test default adalah TAPGO_DISTRIBUTION=play, jadi test tap dashboard
/// di sini berjalan pada distribusi yang sama dengan yang diunggah ke Play
/// Store — bukan pada varian direct.
///
/// Tidak ada panggilan jaringan nyata: permintaan API disuntikkan lewat seam
/// widget atau lewat hook loader-for-tests yang sudah menjadi konvensi repo.

Widget wrapRide(Widget child) {
  return ProviderScope(
    child: MaterialApp(
      theme: tapGoReadableTheme(),
      home: child,
    ),
  );
}

void useTallView(WidgetTester tester, {double width = 412}) {
  tester.view.physicalSize = Size(width * 3, 1400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

/// Spinner indeterminate tidak pernah settle, jadi frame dimajukan eksplisit.
Future<void> settleFrames(WidgetTester tester, {int frames = 12}) async {
  for (var index = 0; index < frames; index += 1) {
    await tester.pump(const Duration(milliseconds: 80));
  }
}

Map<String, dynamic> orderPayload({
  required String status,
  bool isFinal = false,
  String reference = 'RID-A2B3C4D5E6',
  Map<String, dynamic>? driver,
  Map<String, dynamic>? vehicle,
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
    'fare': const {'totalFare': 18500, 'currency': 'IDR'},
    'payment': const {'method': 'CASH', 'state': 'PENDING'},
    'cancellation': null,
    'timeline': const {},
    'driver': driver,
    'vehicle': vehicle,
    'createdAt': '2026-08-03T02:15:00.000Z',
  };
}

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

void main() {
  setUp(() {
    tapGoDisablePersistenceForTests = true;
    tapGoRideHistoryLoaderForTests = null;
    tapGoRideDetailLoaderForTests = null;
  });

  tearDown(() {
    tapGoRideHistoryLoaderForTests = null;
    tapGoRideDetailLoaderForTests = null;
  });

  // -------------------------------------------------------------------------
  // 1–7. Entry point Ojek Online pada distribusi Play
  // -------------------------------------------------------------------------

  group('entry point Ojek Online pada distribusi Play', () {
    Future<void> openDashboard(WidgetTester tester) async {
      useTallView(tester);
      await tester.pumpWidget(
        const ProviderScope(child: MaterialApp(home: TapGoDashboard())),
      );
      await settleFrames(tester);

      // Dashboard sudah overflow 74 px pada kartu promo "Kelas Online Spesial"
      // sejak commit frozen 9d5c5c9befd1, terbukti dengan merender dashboard
      // versi frozen. Struktur Dashboard tidak boleh diubah, jadi overflow itu
      // hanya dikeluarkan dari antrean exception agar test ini benar-benar
      // menguji entry point.
      final pending = tester.takeException();
      if (pending != null) {
        expect(
          pending.toString(),
          contains('overflowed'),
          reason: 'hanya overflow pre-existing yang boleh diabaikan',
        );
      }
    }

    Finder serviceTile(String label) => find.descendant(
          of: find.byType(GridView),
          matching: find.text(label),
        );

    Future<void> tapServiceTile(WidgetTester tester, String label) async {
      final tile = serviceTile(label).first;
      await tester.ensureVisible(tile);
      await settleFrames(tester);
      await tester.tap(tile);
      await settleFrames(tester);
    }

    testWidgets('1. distribusi Play menampilkan entry Motor', (tester) async {
      expect(tapGoIsPlayDistribution, isTrue);
      await openDashboard(tester);

      expect(serviceTile('Motor'), findsOneWidget);
    });

    testWidgets('2. distribusi Play menampilkan entry Mobil', (tester) async {
      expect(tapGoIsPlayDistribution, isTrue);
      await openDashboard(tester);

      expect(serviceTile('Mobil'), findsOneWidget);
    });

    testWidgets('3. tap widget Motor nyata membuka layanan MOTORCYCLE', (
      tester,
    ) async {
      expect(tapGoIsPlayDistribution, isTrue);
      tapGoRideHistoryLoaderForTests = () async => const [];

      await openDashboard(tester);
      await tapServiceTile(tester, 'Motor');

      final gate = tester.widget<RideEntryScreen>(find.byType(RideEntryScreen));
      expect(gate.service, RideServiceKind.motorcycle);
      expect(gate.service.apiValue, 'MOTORCYCLE');
    });

    testWidgets('4. tap widget Mobil nyata membuka layanan CAR', (
      tester,
    ) async {
      expect(tapGoIsPlayDistribution, isTrue);
      tapGoRideHistoryLoaderForTests = () async => const [];

      await openDashboard(tester);
      await tapServiceTile(tester, 'Mobil');

      final gate = tester.widget<RideEntryScreen>(find.byType(RideEntryScreen));
      expect(gate.service, RideServiceKind.car);
      expect(gate.service.apiValue, 'CAR');
    });

    testWidgets('5. entry Ride terlihat tanpa bergantung pada flag demo', (
      tester,
    ) async {
      // Inti blocker: menu harus ada walau provider lokasi belum terpasang.
      // Sengaja TIDAK menegaskan nilai flag, supaya test ini lulus baik pada
      // build default (demo OFF) maupun pada --dart-define demo ON. Lulus di
      // kedua keadaan itulah buktinya bahwa flag bukan syarat visibilitas.
      await openDashboard(tester);

      expect(serviceTile('Motor'), findsOneWidget);
      expect(serviceTile('Mobil'), findsOneWidget);
    });

    testWidgets('6. demo mode OFF membuka state provider belum tersedia', (
      tester,
    ) async {
      expect(tapGoRideDemoMode, isFalse);
      tapGoRideHistoryLoaderForTests = () async => const [];

      await openDashboard(tester);
      await tapServiceTile(tester, 'Motor');

      expect(find.text(tapGoRideLocationUnavailableMessage), findsOneWidget);
      // Tidak ada jalan menuju harga atau pemesanan tanpa provider resmi.
      expect(find.text('Cek Harga'), findsNothing);
      expect(find.text('Pesan Sekarang'), findsNothing);
      // Hanya bermakna pada build tanpa provider demo.
    }, skip: tapGoRideDemoMode);

    test('7. flag demo hanya mengendalikan port lokasi', () {
      // Flag tidak menyentuh visibilitas entry point sama sekali: pemetaan
      // label dan daftar layanan tidak membacanya.
      // Flag menentukan port lokasi — dan hanya itu.
      expect(
        tapGoRideLocationPort(),
        tapGoRideDemoMode
            ? isA<DemoLocationPort>()
            : isA<UnavailableLocationPort>(),
      );
      // Pemetaan entry identik pada kedua keadaan flag.
      expect(tapGoRideEntryServiceFor('Motor'), RideServiceKind.motorcycle);
      expect(tapGoRideEntryServiceFor('Mobil'), RideServiceKind.car);
      expect(
          tapGoRideEntryServiceFor('TapGo Ride'), RideServiceKind.motorcycle);
      expect(tapGoRideEntryServiceFor('TapGo Car'), RideServiceKind.car);
    });

    testWidgets('entry Ride pada Play tidak memunculkan CTA pembayaran luar', (
      tester,
    ) async {
      tapGoRideHistoryLoaderForTests = () async => const [];
      await openDashboard(tester);
      await tapServiceTile(tester, 'Motor');

      // Kepatuhan Google Play Payments Policy: nol tautan pembayaran, nol
      // WebView, nol pembelian eksternal pada alur ini.
      for (final forbidden in const [
        'Bayar',
        'Beli',
        'Upgrade',
        'WebView',
        'http://',
        'https://',
      ]) {
        expect(
          find.textContaining(forbidden),
          findsNothing,
          reason: 'teks terlarang muncul pada entry Ride: $forbidden',
        );
      }
      expect(find.byType(RideEntryScreen), findsOneWidget);
    });

    // Overflow yang SUDAH ada pada dashboard Play sebelum entry Ride
    // ditambahkan. Terbukti identik dengan dan tanpa kartu Motor/Mobil, jadi
    // daftar ini mengunci baseline: overflow baru apa pun akan menggagalkan
    // test, sementara yang lama tidak menutupi apa-apa.
    final preExistingOverflows = <double, Set<String>>{
      320.0: {
        'A RenderFlex overflowed by 12 pixels on the bottom.',
        'A RenderFlex overflowed by 30 pixels on the right.',
      },
      360.0: <String>{},
      412.0: <String>{},
    };

    for (final width in <double>[320, 360, 412]) {
      testWidgets('entry Ride tidak menambah overflow pada ${width.toInt()} dp',
          (tester) async {
        final captured = <String>{};
        final previousHandler = FlutterError.onError;
        FlutterError.onError =
            (details) => captured.add(details.exception.toString());

        useTallView(tester, width: width);
        await tester.pumpWidget(
          const ProviderScope(child: MaterialApp(home: TapGoDashboard())),
        );
        await settleFrames(tester);
        FlutterError.onError = previousHandler;
        tester.takeException();

        expect(
          captured,
          equals(preExistingOverflows[width]),
          reason: 'entry Motor/Mobil tidak boleh menambah overflow baru',
        );
        expect(serviceTile('Motor'), findsOneWidget);
        expect(serviceTile('Mobil'), findsOneWidget);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 8–19. Pemulihan perjalanan aktif
  // -------------------------------------------------------------------------

  group('pemulihan perjalanan aktif', () {
    Future<void> pumpGate(
      WidgetTester tester, {
      required RideHistoryRequest historyRequest,
      RideDetailRequest? detailRequest,
      RideQuoteRequest? quoteRequest,
      RideOrderRequest? orderRequest,
    }) async {
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideEntryScreen(
            service: RideServiceKind.motorcycle,
            locationPort: const DemoLocationPort(),
            historyRequest: historyRequest,
            detailRequest: detailRequest,
            quoteRequest: quoteRequest,
            orderRequest: orderRequest,
          ),
        ),
      );
      await settleFrames(tester);
    }

    testWidgets('8. satu perjalanan aktif ditemukan membuka layar status', (
      tester,
    ) async {
      await pumpGate(
        tester,
        historyRequest: () async => [
          orderPayload(
              status: 'COMPLETED', isFinal: true, reference: 'RID-OLD11AAAA1'),
          orderPayload(status: 'DRIVER_ASSIGNED'),
        ],
        detailRequest: (_) async => orderPayload(
          status: 'DRIVER_ASSIGNED',
          driver: const {'displayName': 'Budi'},
          vehicle: const {
            'serviceType': 'MOTORCYCLE',
            'maskedPlate': 'B 12•• XYZ',
          },
        ),
      );

      expect(find.byType(RideStatusScreen), findsOneWidget);
      expect(find.byType(RideBookingScreen), findsNothing);
      expect(find.text('Driver menerima pesanan'), findsOneWidget);
      expect(find.text('Budi'), findsOneWidget);
    });

    testWidgets('9. pemulihan tidak membuat quote', (tester) async {
      var quoteCalls = 0;
      await pumpGate(
        tester,
        historyRequest: () async => [orderPayload(status: 'SEARCHING_DRIVER')],
        detailRequest: (_) async => orderPayload(status: 'SEARCHING_DRIVER'),
        quoteRequest: ({
          required serviceType,
          required pickup,
          required dropoff,
        }) async {
          quoteCalls += 1;
          return const {};
        },
      );

      expect(quoteCalls, 0);
      expect(find.text('Cek Harga'), findsNothing);
    });

    testWidgets('10. pemulihan tidak membuat order', (tester) async {
      var orderCalls = 0;
      await pumpGate(
        tester,
        historyRequest: () async => [orderPayload(status: 'IN_TRIP')],
        detailRequest: (_) async => orderPayload(status: 'IN_TRIP'),
        orderRequest: ({required quoteId, idempotencyKey}) async {
          orderCalls += 1;
          return const {};
        },
      );

      expect(orderCalls, 0);
      expect(find.text('Pesan Sekarang'), findsNothing);
      expect(find.text('Perjalanan berlangsung'), findsOneWidget);
    });

    testWidgets('11. perjalanan yang dipulihkan memakai reference server', (
      tester,
    ) async {
      final requestedReferences = <String>[];
      await pumpGate(
        tester,
        historyRequest: () async => [
          orderPayload(status: 'DRIVER_TO_PICKUP', reference: 'RID-SERVER9XYZ'),
        ],
        detailRequest: (reference) async {
          requestedReferences.add(reference);
          return orderPayload(
            status: 'DRIVER_TO_PICKUP',
            reference: 'RID-SERVER9XYZ',
          );
        },
      );

      final screen = tester.widget<RideStatusScreen>(
        find.byType(RideStatusScreen),
      );
      expect(screen.reference, 'RID-SERVER9XYZ');
      // Detail dimuat ulang lewat GET /rides/:reference dengan reference itu.
      expect(requestedReferences, contains('RID-SERVER9XYZ'));
      expect(find.text('Kode perjalanan RID-SERVER9XYZ'), findsOneWidget);
    });

    testWidgets('12. polling perjalanan yang dipulihkan tidak tumpang-tindih', (
      tester,
    ) async {
      var detailCalls = 0;
      var outstanding = 0;
      var maxOutstanding = 0;
      Completer<Map<String, dynamic>>? pending;

      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideEntryScreen(
            service: RideServiceKind.motorcycle,
            historyRequest: () async =>
                [orderPayload(status: 'SEARCHING_DRIVER')],
            detailRequest: (_) {
              detailCalls += 1;
              outstanding += 1;
              maxOutstanding =
                  outstanding > maxOutstanding ? outstanding : maxOutstanding;
              final completer = Completer<Map<String, dynamic>>();
              pending = completer;
              return completer.future.whenComplete(() => outstanding -= 1);
            },
          ),
        ),
      );
      // Interval polling default 4 detik; frame dimajukan jauh melewatinya
      // sementara permintaan pertama sengaja dibiarkan menggantung.
      for (var index = 0; index < 40; index += 1) {
        await tester.pump(const Duration(milliseconds: 500));
      }
      expect(detailCalls, 1,
          reason: 'tick berikutnya dilewati, bukan ditumpuk');
      expect(outstanding, 1);

      // Setelah permintaan pertama selesai, polling MEMANG lanjut — itu memang
      // tujuannya. Yang tidak boleh terjadi adalah dua permintaan bersamaan.
      pending!.complete(orderPayload(status: 'SEARCHING_DRIVER'));
      await settleFrames(tester);
      for (var index = 0; index < 40; index += 1) {
        await tester.pump(const Duration(milliseconds: 500));
      }

      expect(
        detailCalls,
        greaterThan(1),
        reason: 'polling berlanjut selama perjalanan belum final',
      );
      expect(
        maxOutstanding,
        1,
        reason: 'tidak boleh ada dua permintaan status berjalan bersamaan',
      );
    });

    testWidgets('13. resume dari background melakukan tepat satu refresh', (
      tester,
    ) async {
      var detailCalls = 0;
      useTallView(tester);
      await tester.pumpWidget(
        wrapRide(
          RideStatusScreen(
            reference: 'RID-A2B3C4D5E6',
            // Interval panjang supaya yang terhitung hanya akibat lifecycle.
            pollInterval: const Duration(hours: 1),
            detailRequest: (_) async {
              detailCalls += 1;
              return orderPayload(status: 'SEARCHING_DRIVER');
            },
          ),
        ),
      );
      await settleFrames(tester);
      expect(detailCalls, 1, reason: 'satu permintaan saat layar dibuka');

      final binding = tester.binding;
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await settleFrames(tester);
      expect(detailCalls, 1, reason: 'background tidak boleh polling');

      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settleFrames(tester);
      expect(detailCalls, 2, reason: 'resume tepat satu refresh, bukan dua');
    });

    testWidgets('14. rebuild widget tidak menghasilkan order baru', (
      tester,
    ) async {
      var orderCalls = 0;
      var historyCalls = 0;

      Widget tree() => wrapRide(
            RideEntryScreen(
              service: RideServiceKind.motorcycle,
              historyRequest: () async {
                historyCalls += 1;
                return [orderPayload(status: 'DRIVER_ARRIVED')];
              },
              detailRequest: (_) async =>
                  orderPayload(status: 'DRIVER_ARRIVED'),
              orderRequest: ({required quoteId, idempotencyKey}) async {
                orderCalls += 1;
                return const {};
              },
            ),
          );

      useTallView(tester);
      await tester.pumpWidget(tree());
      await settleFrames(tester);
      // Widget dibuat ulang, seperti saat konfigurasi perangkat berubah.
      await tester.pumpWidget(tree());
      await settleFrames(tester);

      expect(orderCalls, 0);
      expect(historyCalls, greaterThanOrEqualTo(1));
      expect(find.byType(RideStatusScreen), findsOneWidget);
      expect(find.text('Driver sudah tiba'), findsOneWidget);
    });

    test('15. perjalanan terminal tidak dianggap aktif', () {
      for (final status in const [
        'COMPLETED',
        'CANCELLED_BY_PASSENGER',
        'CANCELLED_BY_DRIVER',
        'CANCELLED_BY_SYSTEM',
        'NO_DRIVER',
        'EXPIRED',
        'PAYMENT_FAILED',
      ]) {
        final order = RideOrderView.fromJson(
          orderPayload(status: status, isFinal: true),
        );
        expect(
          order.isRestorableActive,
          isFalse,
          reason: '$status tidak boleh dipulihkan sebagai perjalanan aktif',
        );
      }
      // Fail closed dua kali: status berjalan yang sudah ditandai final oleh
      // server juga tidak dipulihkan.
      expect(
        RideOrderView.fromJson(
          orderPayload(status: 'IN_TRIP', isFinal: true),
        ).isRestorableActive,
        isFalse,
      );
      // Dan status yang tidak dikenal tidak pernah dianggap aktif.
      expect(
        RideOrderView.fromJson(
          orderPayload(status: 'TELEPORTED'),
        ).isRestorableActive,
        isFalse,
      );
      // Keenam status berjalan memang dipulihkan.
      for (final status in tapGoRideActiveStatuses) {
        expect(
          RideOrderView.fromJson(orderPayload(status: status))
              .isRestorableActive,
          isTrue,
          reason: '$status seharusnya dipulihkan',
        );
      }
    });

    testWidgets('15b. riwayat berisi hanya perjalanan terminal tetap booking', (
      tester,
    ) async {
      await pumpGate(
        tester,
        historyRequest: () async => [
          orderPayload(status: 'COMPLETED', isFinal: true),
          orderPayload(
            status: 'CANCELLED_BY_PASSENGER',
            isFinal: true,
            reference: 'RID-Z9Y8X7W6V5',
          ),
        ],
      );

      expect(find.byType(RideBookingScreen), findsOneWidget);
      expect(find.byType(RideStatusScreen), findsNothing);
    });

    testWidgets('16. tanpa perjalanan aktif menampilkan booking normal', (
      tester,
    ) async {
      await pumpGate(tester, historyRequest: () async => const []);

      expect(find.byType(RideBookingScreen), findsOneWidget);
      expect(find.byType(RideStatusScreen), findsNothing);
      expect(find.text('Cek Harga'), findsOneWidget);
    });

    testWidgets('17. lebih dari satu perjalanan aktif fail closed', (
      tester,
    ) async {
      var orderCalls = 0;
      await pumpGate(
        tester,
        historyRequest: () async => [
          orderPayload(status: 'DRIVER_ASSIGNED', reference: 'RID-AAAA22BBB2'),
          orderPayload(status: 'SEARCHING_DRIVER', reference: 'RID-CCCC33DDD3'),
        ],
        detailRequest: (_) async => orderPayload(status: 'DRIVER_ASSIGNED'),
        orderRequest: ({required quoteId, idempotencyKey}) async {
          orderCalls += 1;
          return const {};
        },
      );

      // Tidak memilih sendiri, tidak menawarkan pemesanan baru.
      expect(find.byType(RideStatusScreen), findsNothing);
      expect(find.byType(RideBookingScreen), findsNothing);
      expect(find.text('Cek Harga'), findsNothing);
      expect(orderCalls, 0);
      // Pengguna diberi penjelasan dan daftar agar tetap bisa membuka.
      expect(
        find.text('Ada lebih dari satu perjalanan berjalan'),
        findsOneWidget,
      );
      expect(find.text('RID-AAAA22BBB2'), findsOneWidget);
      expect(find.text('RID-CCCC33DDD3'), findsOneWidget);

      // Memilih satu membuka layar status untuk reference itu.
      await tester.tap(find.text('RID-CCCC33DDD3'));
      await settleFrames(tester);
      final screen = tester.widget<RideStatusScreen>(
        find.byType(RideStatusScreen),
      );
      expect(screen.reference, 'RID-CCCC33DDD3');
    });

    testWidgets('18. kegagalan jaringan saat pemulihan dapat dicoba ulang', (
      tester,
    ) async {
      var attempt = 0;
      await pumpGate(
        tester,
        historyRequest: () async {
          attempt += 1;
          if (attempt == 1) {
            throw dioError(type: DioExceptionType.connectionError);
          }
          return [orderPayload(status: 'SEARCHING_DRIVER')];
        },
        detailRequest: (_) async => orderPayload(status: 'SEARCHING_DRIVER'),
      );

      expect(find.text('Gagal memuat perjalanan'), findsOneWidget);
      expect(
        find.textContaining('Koneksi ke server TapGo terputus'),
        findsOneWidget,
      );
      // Kegagalan transient TIDAK melempar pengguna ke layar masuk.
      expect(find.byType(AuthScreen), findsNothing);
      // Dan tidak diam-diam menawarkan pemesanan baru.
      expect(find.byType(RideBookingScreen), findsNothing);

      await tester.tap(find.text('Coba lagi'));
      await settleFrames(tester);
      expect(find.byType(RideStatusScreen), findsOneWidget);
      expect(find.text('Mencari driver'), findsOneWidget);
    });

    testWidgets('19. sesi tidak sah mengikuti auth handling existing', (
      tester,
    ) async {
      await pumpGate(
        tester,
        historyRequest: () async =>
            throw dioError(statusCode: 401, code: 'AUTH_SESSION_REVOKED'),
      );

      expect(find.byType(AuthScreen), findsOneWidget);
      expect(find.byType(RideEntryScreen), findsNothing);
    });

    test('19b. hanya 401 yang dianggap sesi tidak sah', () {
      // Kegagalan jaringan transient tidak boleh memaksa logout.
      for (final type in const [
        DioExceptionType.connectionError,
        DioExceptionType.connectionTimeout,
        DioExceptionType.receiveTimeout,
        DioExceptionType.sendTimeout,
      ]) {
        expect(
          tapGoRideIsSessionExpired(dioError(type: type)),
          isFalse,
          reason: '$type bukan sesi tidak sah',
        );
      }
      expect(tapGoRideIsSessionExpired(dioError(statusCode: 500)), isFalse);
      expect(tapGoRideIsSessionExpired(dioError(statusCode: 503)), isFalse);
      expect(
        tapGoRideIsSessionExpired(
          dioError(statusCode: 401, code: 'AUTH_SESSION_REVOKED'),
        ),
        isTrue,
      );
    });

    testWidgets('pesan pemulihan tidak membocorkan exception atau token', (
      tester,
    ) async {
      await pumpGate(
        tester,
        historyRequest: () async => throw StateError('token=secret-abc123'),
      );

      expect(
        find.text('Perjalanan belum dapat diproses. Silakan coba lagi.'),
        findsOneWidget,
      );
      for (final leak in const [
        'StateError',
        'secret-abc123',
        'token=',
        'Bearer',
        'DioException',
      ]) {
        expect(find.textContaining(leak), findsNothing, reason: 'bocor: $leak');
      }
    });
  });
}
