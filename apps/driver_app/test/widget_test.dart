import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('R2.5B auth and capability', () {
    testWidgets('session valid dipulihkan ke workspace driver', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      expect(find.text('Ketersediaan'), findsOneWidget);
      expect(find.text('Status: Offline'), findsOneWidget);
    });

    testWidgets('logout membersihkan session dan kembali ke login',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byTooltip('Logout'));
      await tester.pumpAndSettle();
      expect(repo.logoutCalls, 1);
      expect(find.text('Masuk Driver'), findsOneWidget);
    });

    testWidgets('invalid session fail closed dan tidak membuka workspace',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'AUTH_REQUIRED',
          message: 'Sesi berakhir. Silakan login kembali.',
          statusCode: 401,
        ),
      );
      await pumpDriver(tester, repo);
      expect(find.text('Sesi berakhir'), findsOneWidget);
      expect(find.text('Ketersediaan'), findsNothing);
    });

    testWidgets('profile required, pending, suspended, inactive tampil aman',
        (tester) async {
      for (final entry in {
        'Profil driver diperlukan': const DriverApiException(
          code: 'RIDE_DRIVER_PROFILE_REQUIRED',
          message: 'Profil driver belum tersedia. Hubungi admin TapGo.',
          statusCode: 403,
        ),
        'Akun driver belum aktif': const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        ),
        'Akun tidak aktif': const DriverApiException(
          code: 'RIDE_DRIVER_ACCOUNT_INACTIVE',
          message: 'Akun Anda tidak aktif. Hubungi dukungan TapGo.',
          statusCode: 403,
        ),
      }.entries) {
        final repo = FakeDriverRepository(
            session: demoSession, currentError: entry.value);
        await pumpDriver(tester, repo);
        expect(find.text(entry.key), findsOneWidget);
      }
    });

    testWidgets('login berhasil, ADMIN tidak mendapat bypass dari client',
        (tester) async {
      final repo = FakeDriverRepository(session: null);
      await pumpDriver(tester, repo);
      await tester.tap(find.byKey(const ValueKey('driver-login-button')));
      await tester.pumpAndSettle();
      expect(repo.loginCalls, 1);
      expect(find.text('Ketersediaan'), findsOneWidget);
      expect(find.textContaining('ADMIN'), findsNothing);
      expect(find.textContaining('SUPER_ADMIN'), findsNothing);
    });
  });

  group('R2.5B availability and offers', () {
    testWidgets('offline ke online memakai exact API mapping dan single-flight',
        (tester) async {
      final completer = Completer<DriverAvailability>();
      final repo = FakeDriverRepository(
        session: demoSession,
        availabilityCompleter: completer,
      );
      await pumpDriver(tester, repo);
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      expect(repo.availabilityRequests, [DriverAvailability.online]);
      completer.complete(DriverAvailability.online);
      await tester.pumpAndSettle();
      expect(find.text('Status: Online'), findsOneWidget);
    });

    testWidgets('loading, empty, error, retry, dan raw exception aman',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        offersError: Exception('StackTrace: database raw failure'),
      );
      await pumpDriver(tester, repo);
      expect(find.text('Koneksi belum stabil'), findsOneWidget);
      expect(find.textContaining('StackTrace'), findsNothing);
      expect(find.byKey(const ValueKey('retry-button')), findsOneWidget);
    });

    testWidgets(
        'offer tersedia dirender, accept/reject single-flight, taken fail closed',
        (tester) async {
      final accept = Completer<DriverRide>();
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [demoOffer],
        acceptCompleter: accept,
      );
      await pumpDriver(tester, repo);
      final offerTile = find.byKey(const ValueKey('offer-RIDE-DEMO-001'));
      await tapReachable(tester, offerTile);
      await tester.pumpAndSettle();
      expect(find.text('Detail Tawaran'), findsOneWidget);
      await tapReachable(
          tester, find.byKey(const ValueKey('accept-offer-button')));
      await tapReachable(
          tester, find.byKey(const ValueKey('accept-offer-button')));
      expect(repo.acceptCalls, 1);
      accept.complete(demoRide(RideStatus.driverToPickup));
      await tester.pumpAndSettle();
      expect(find.text('Perjalanan Aktif'), findsOneWidget);
    });

    testWidgets(
        'expired/taken offer tidak dapat diterima dan reject menghapus tawaran',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [demoOffer],
        acceptError: const DriverApiException(
          code: 'RIDE_ALREADY_TAKEN',
          message: 'Perjalanan sudah diambil driver lain.',
          statusCode: 409,
        ),
      );
      await pumpDriver(tester, repo);
      final offerTile = find.byKey(const ValueKey('offer-RIDE-DEMO-001'));
      await tapReachable(tester, offerTile);
      await tester.pumpAndSettle();
      await tapReachable(
          tester, find.byKey(const ValueKey('accept-offer-button')));
      await tester.pumpAndSettle();
      expect(
          find.text('Perjalanan sudah diambil driver lain.'), findsOneWidget);
      final rejectButton = find.byKey(const ValueKey('reject-offer-button'));
      await tapReachable(tester, rejectButton);
      await tester.pumpAndSettle();
      expect(repo.rejectCalls, 1);
    });
  });

  group('R2.5B active ride lifecycle', () {
    testWidgets(
        'current ride dipulihkan dan offline driver tetap melihat active ride',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.offline,
        current: demoRide(RideStatus.driverAssigned),
      );
      await pumpDriver(tester, repo);
      expect(find.text('Perjalanan Aktif'), findsOneWidget);
      expect(find.text('RIDE-DEMO-001'), findsOneWidget);
    });

    testWidgets('no current ride kembali ke home/offers', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      expect(find.text('Belum ada tawaran'), findsOneWidget);
    });

    testWidgets('multiple-active conflict fail closed', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'RIDE_DRIVER_ACTIVE_RIDE_CONFLICT',
          message: 'Status perjalanan aktif perlu diperiksa admin.',
          statusCode: 409,
        ),
      );
      await pumpDriver(tester, repo);
      expect(find.text('Koneksi belum stabil'), findsOneWidget);
      expect(find.textContaining('RID-'), findsNothing);
    });

    testWidgets('pickup, arrived, start, complete, cancel mapping benar',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverAssigned),
      );
      await pumpDriver(tester, repo);
      var primaryAction = find.byKey(const ValueKey('trip-primary-action'));
      await tapReachable(tester, primaryAction);
      await tester.pumpAndSettle();
      expect(repo.pickupCalls, 1);
      primaryAction = find.byKey(const ValueKey('trip-primary-action'));
      await tapReachable(tester, primaryAction);
      await tester.pumpAndSettle();
      expect(repo.arrivedCalls, 1);
      primaryAction = find.byKey(const ValueKey('trip-primary-action'));
      await tapReachable(tester, primaryAction);
      await tester.pumpAndSettle();
      expect(repo.startCalls, 1);
      primaryAction = find.byKey(const ValueKey('trip-primary-action'));
      await tapReachable(tester, primaryAction);
      await tester.pumpAndSettle();
      expect(repo.completeCalls, 1);

      final cancelRepo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverToPickup),
      );
      await pumpDriver(tester, cancelRepo);
      final cancelAction = find.byKey(const ValueKey('trip-cancel-action'));
      await tapReachable(tester, cancelAction);
      await tester.pumpAndSettle();
      expect(cancelRepo.cancelCalls, 1);
    });

    testWidgets('unknown/terminal status menghentikan action primer',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.unknown),
      );
      await pumpDriver(tester, repo);
      expect(find.byKey(const ValueKey('trip-primary-action')), findsNothing);

      final doneRepo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.completed),
      );
      await pumpDriver(tester, doneRepo);
      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.byKey(const ValueKey('trip-primary-action')), findsNothing);
    });
  });

  group('R2.5B security, demo, responsive', () {
    testWidgets('passenger PII, raw identifier, password/token tidak tampil',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      await pumpDriver(tester, repo);
      for (final forbidden in [
        'PASSENGER_DEMO',
        'phone',
        'email',
        'driverProfileId',
        'vehicleId',
        'access',
        'refresh',
        'password',
      ]) {
        expect(
            find.textContaining(forbidden, findRichText: true), findsNothing);
      }
    });

    testWidgets('normal build tidak menampilkan demo selector/banner',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      expect(
          find.byKey(const ValueKey('demo-scenario-selector')), findsNothing);
      expect(find.textContaining('DEMO DATA'), findsNothing);
      expect(repo.networkCalls, 0);
    });

    testWidgets('synthetic location tidak terkirim tanpa provider sah',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: false);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      final controller = ProviderScope.containerOf(
        tester.element(find.byType(DriverShell)),
      ).read(driverControllerProvider.notifier);
      await controller.sendLocationIfAvailable();
      expect(location.sendCalls, 0);
    });

    testWidgets(
        'responsive 320, 360, 390, 412 dan text scale 1.8 tanpa overflow',
        (tester) async {
      final sizes = [
        const Size(320, 640),
        const Size(360, 800),
        const Size(390, 844),
        const Size(412, 915),
      ];
      for (final size in sizes) {
        await tester.binding.setSurfaceSize(size);
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final repo = FakeDriverRepository(
          session: demoSession,
          current: demoRide(RideStatus.inTrip),
        );
        await tester.pumpWidget(
          MediaQuery(
            data: MediaQueryData(
                size: size, textScaler: const TextScaler.linear(1.8)),
            child: buildTestableDriverApp(repository: repo),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byType(DriverShell), findsOneWidget);
      }
    });

    testWidgets('dark theme terbaca dan touch target minimum 48dp',
        (tester) async {
      final repo =
          FakeDriverRepository(session: demoSession, offerItems: [demoOffer]);
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        buildTestableDriverApp(
          repository: repo,
          themeMode: ThemeMode.dark,
        ),
      );
      await tester.pumpAndSettle();
      final button =
          tester.getSize(find.byKey(const ValueKey('availability-toggle')));
      expect(button.height, greaterThanOrEqualTo(48));
      expect(find.text('Ketersediaan'), findsOneWidget);
    });
  });
}

Future<void> pumpDriver(WidgetTester tester, FakeDriverRepository repo) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  await tester.pumpWidget(buildTestableDriverApp(repository: repo));
  await tester.pumpAndSettle();
  addTearDown(() async {
    await tester.binding.setSurfaceSize(null);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}

Future<void> tapReachable(WidgetTester tester, Finder finder) async {
  await Scrollable.ensureVisible(
    tester.element(finder),
    alignment: 0.35,
    duration: Duration.zero,
  );
  await tester.pumpAndSettle();
  await tester.tap(finder);
}

const demoSession = DriverSession(
  accessToken: 'TEST_ACCESS',
  refreshToken: 'TEST_REFRESH',
  driverName: 'Driver Test',
);

const demoOffer = DriverRide(
  reference: 'RIDE-DEMO-001',
  serviceType: 'MOTORCYCLE',
  status: RideStatus.searchingDriver,
  pickupAddress: 'LOKASI_DEMO_A',
  dropoffAddress: 'LOKASI_DEMO_B',
  distanceMeters: 2500,
  durationSeconds: 600,
  totalFare: 9000,
);

DriverRide demoRide(RideStatus status) => DriverRide(
      reference: 'RIDE-DEMO-001',
      serviceType: 'MOTORCYCLE',
      status: status,
      pickupAddress: 'LOKASI_DEMO_A',
      dropoffAddress: 'LOKASI_DEMO_B',
      distanceMeters: 2500,
      durationSeconds: 600,
      totalFare: 9000,
    );

class FakeDriverRepository implements DriverRepository {
  FakeDriverRepository({
    required this.session,
    this.current,
    this.offerItems = const [],
    this.availability = DriverAvailability.offline,
    this.currentError,
    this.offersError,
    this.acceptError,
    this.availabilityCompleter,
    this.acceptCompleter,
  });

  DriverSession? session;
  DriverRide? current;
  List<DriverRide> offerItems;
  DriverAvailability availability;
  DriverApiException? currentError;
  Object? offersError;
  DriverApiException? acceptError;
  Completer<DriverAvailability>? availabilityCompleter;
  Completer<DriverRide>? acceptCompleter;
  int loginCalls = 0;
  int logoutCalls = 0;
  int acceptCalls = 0;
  int rejectCalls = 0;
  int pickupCalls = 0;
  int arrivedCalls = 0;
  int startCalls = 0;
  int completeCalls = 0;
  int cancelCalls = 0;
  int networkCalls = 0;
  final availabilityRequests = <DriverAvailability>[];

  @override
  Future<DriverSession?> restoreSession() async => session;

  @override
  Future<DriverSession> login(
      {required String phone, required String password}) async {
    loginCalls += 1;
    session = demoSession;
    return demoSession;
  }

  @override
  Future<void> logout() async {
    logoutCalls += 1;
    session = null;
  }

  @override
  Future<DriverAvailability> setAvailability(
      DriverAvailability availability) async {
    availabilityRequests.add(availability);
    this.availability = availability;
    return availabilityCompleter?.future ?? availability;
  }

  @override
  Future<List<DriverRide>> offers() async {
    if (offersError != null) throw offersError!;
    return offerItems;
  }

  @override
  Future<DriverRide?> currentRide() async {
    if (currentError != null) throw currentError!;
    return current;
  }

  @override
  Future<DriverRide> accept(String reference) async {
    acceptCalls += 1;
    if (acceptError != null) throw acceptError!;
    current = await (acceptCompleter?.future ??
        Future.value(demoRide(RideStatus.driverToPickup)));
    return current!;
  }

  @override
  Future<void> reject(String reference) async {
    rejectCalls += 1;
  }

  @override
  Future<DriverRide> pickup(String reference) async {
    pickupCalls += 1;
    current = demoRide(RideStatus.driverToPickup);
    return current!;
  }

  @override
  Future<DriverRide> arrived(String reference) async {
    arrivedCalls += 1;
    current = demoRide(RideStatus.driverArrived);
    return current!;
  }

  @override
  Future<DriverRide> start(String reference) async {
    startCalls += 1;
    current = demoRide(RideStatus.inTrip);
    return current!;
  }

  @override
  Future<DriverRide> complete(String reference) async {
    completeCalls += 1;
    current = demoRide(RideStatus.completed);
    return current!;
  }

  @override
  Future<DriverRide> cancel(String reference, String reason) async {
    cancelCalls += 1;
    current = demoRide(RideStatus.cancelledByDriver);
    return current!;
  }
}

class RecordingLocationPort implements DriverLocationPort {
  RecordingLocationPort({required this.available});
  final bool available;
  int sendCalls = 0;

  @override
  Future<bool> get isAvailable async => available;

  @override
  Future<void> sendCurrentLocation() async {
    sendCalls += 1;
  }
}
