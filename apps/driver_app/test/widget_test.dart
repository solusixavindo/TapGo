import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('R2.5C login branding dan ikon', () {
    /// Membuka layar login pada viewport ponsel nyata.
    Future<void> pumpLogin(
      WidgetTester tester, {
      ThemeMode themeMode = ThemeMode.light,
      double textScale = 1.0,
      Size size = const Size(360, 800),
      FakeDriverRepository? repository,
    }) async {
      await tester.binding.setSurfaceSize(size);
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });
      final app = buildTestableDriverApp(
        repository: repository ?? FakeDriverRepository(session: null),
        themeMode: themeMode,
      );
      await tester.pumpWidget(
        MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(textScale),
          ),
          child: app,
        ),
      );
      await tester.pumpAndSettle();
    }

    Image logoImage(WidgetTester tester) {
      return tester.widget<Image>(
        find.descendant(
          of: find.byType(LoginScreen),
          matching: find.byType(Image),
        ),
      );
    }

    testWidgets('1. logo resmi TapGo dirender dari asset lokal', (
      tester,
    ) async {
      await pumpLogin(tester);
      final image = logoImage(tester);
      final provider = image.image;
      expect(provider, isA<AssetImage>());
      expect(
        (provider as AssetImage).assetName,
        driverBrandLogoAsset,
        reason: 'brand mark harus memakai asset logo resmi',
      );
      // Aset lokal, bukan jaringan.
      expect(provider, isNot(isA<NetworkImage>()));
      expect(driverBrandLogoAsset, 'assets/images/tapgo_logo_512.png');
    });

    testWidgets('2. Icons.local_taxi_rounded tidak lagi menjadi brand mark', (
      tester,
    ) async {
      await pumpLogin(tester);
      expect(
        find.descendant(
          of: find.byType(LoginScreen),
          matching: find.byIcon(Icons.local_taxi_rounded),
        ),
        findsNothing,
      );
    });

    testWidgets('3. CTA memakai copy Masuk sebagai Driver', (tester) async {
      await pumpLogin(tester);
      expect(find.text('Masuk sebagai Driver'), findsOneWidget);
      expect(find.text('Login'), findsNothing);
    });

    testWidgets('4. field nomor HP punya leading icon', (tester) async {
      await pumpLogin(tester);
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('driver-phone-input')),
      );
      expect(field.decoration?.prefixIcon, isNotNull);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('driver-phone-input')),
          matching: find.byIcon(Icons.smartphone_rounded),
        ),
        findsOneWidget,
      );
    });

    testWidgets('5. field password punya leading icon', (tester) async {
      await pumpLogin(tester);
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('driver-password-input')),
      );
      expect(field.decoration?.prefixIcon, isNotNull);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('driver-password-input')),
          matching: find.byIcon(Icons.lock_rounded),
        ),
        findsOneWidget,
      );
    });

    testWidgets('6. kontrol visibility mengubah obscure state', (tester) async {
      await pumpLogin(tester);
      TextField passwordField() => tester.widget<TextField>(
            find.byKey(const ValueKey('driver-password-input')),
          );

      // Default tersembunyi.
      expect(passwordField().obscureText, isTrue);
      expect(find.byIcon(Icons.visibility_rounded), findsOneWidget);

      await tester
          .tap(find.byKey(const ValueKey('driver-password-visibility')));
      await tester.pumpAndSettle();
      expect(passwordField().obscureText, isFalse);
      expect(find.byIcon(Icons.visibility_off_rounded), findsOneWidget);

      await tester
          .tap(find.byKey(const ValueKey('driver-password-visibility')));
      await tester.pumpAndSettle();
      expect(passwordField().obscureText, isTrue);
    });

    testWidgets('7. login light theme tidak overflow', (tester) async {
      final overflows = <String>{};
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        final message = details.exception.toString().split('\n').first;
        if (message.contains('overflowed')) {
          overflows.add(message);
        } else {
          previous?.call(details);
        }
      };
      addTearDown(() => FlutterError.onError = previous);

      await pumpLogin(tester);
      expect(overflows, isEmpty);
      expect(find.text('Masuk sebagai Driver'), findsOneWidget);
    });

    testWidgets('8. login dark theme tidak overflow dan terbaca', (
      tester,
    ) async {
      final overflows = <String>{};
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        final message = details.exception.toString().split('\n').first;
        if (message.contains('overflowed')) {
          overflows.add(message);
        } else {
          previous?.call(details);
        }
      };
      addTearDown(() => FlutterError.onError = previous);

      await pumpLogin(tester, themeMode: ThemeMode.dark);
      expect(overflows, isEmpty);
      expect(find.text('TapGo Driver'), findsWidgets);
      expect(find.text('Masuk sebagai Driver'), findsOneWidget);
      expect(logoImage(tester).image, isA<AssetImage>());
    });

    testWidgets('9. text scale 1.8 tidak overflow dan tetap dapat digulir', (
      tester,
    ) async {
      final overflows = <String>{};
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        final message = details.exception.toString().split('\n').first;
        if (message.contains('overflowed')) {
          overflows.add(message);
        } else {
          previous?.call(details);
        }
      };
      addTearDown(() => FlutterError.onError = previous);

      await pumpLogin(tester, textScale: 1.8, size: const Size(360, 800));
      expect(overflows, isEmpty);

      final position =
          tester.state<ScrollableState>(find.byType(Scrollable).first).position;
      expect(position.maxScrollExtent, greaterThan(0));
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -260));
      await tester.pumpAndSettle();
      expect(position.pixels, greaterThan(0));
      expect(overflows, isEmpty);
    });

    testWidgets('10. target sentuh aksi minimum 48 dp', (tester) async {
      await pumpLogin(tester);
      final cta = tester.getSize(
        find.byKey(const ValueKey('driver-login-button')),
      );
      expect(cta.height, greaterThanOrEqualTo(48));
      final toggle = tester.getSize(
        find.byKey(const ValueKey('driver-password-visibility')),
      );
      expect(toggle.height, greaterThanOrEqualTo(48));
      expect(toggle.width, greaterThanOrEqualTo(48));
    });

    testWidgets('11. state loading tetap menampilkan label CTA', (
      tester,
    ) async {
      final gate = Completer<DriverSession>();
      final repo = FakeDriverRepository(session: null, loginCompleter: gate);
      await pumpLogin(tester, repository: repo);

      await tester.tap(find.byKey(const ValueKey('driver-login-button')));
      await tester.pump();

      // Permintaan masih berjalan: label tetap terbaca dan tombol nonaktif,
      // sehingga tap beruntun tidak mengirim login kedua.
      final button = tester.widget<FilledButton>(
        find.byKey(const ValueKey('driver-login-button')),
      );
      expect(button.onPressed, isNull);
      expect(find.text('Masuk sebagai Driver'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('driver-login-button')),
        warnIfMissed: false,
      );
      await tester.pump();
      expect(repo.loginCalls, 1);

      gate.complete(demoSession);
      await tester.pumpAndSettle();
      expect(repo.loginCalls, 1);
    });

    testWidgets('12. login demo tetap bekerja', (tester) async {
      final repo = FakeDriverRepository(session: null);
      await pumpLogin(tester, repository: repo);
      await tester.tap(find.byKey(const ValueKey('driver-login-button')));
      await tester.pumpAndSettle();
      expect(repo.loginCalls, 1);
      expect(find.byType(LoginScreen), findsNothing);
    });

    testWidgets('13. mode normal tidak memuat widget demo', (tester) async {
      await pumpLogin(tester);
      // Tanpa TAPGO_DRIVER_DEMO_MODE, widget demo tidak berada di widget tree
      // sama sekali — bukan disembunyikan dengan opacity atau Offstage.
      expect(kDriverDemoMode, isFalse);
      expect(find.byType(DemoScenarioSelector), findsNothing);
      expect(find.byType(DemoBanner), findsNothing);
      expect(
        find.textContaining('DEMO DATA'),
        findsNothing,
      );
    });

    testWidgets('14. auth contract tidak berubah', (tester) async {
      final repo = FakeDriverRepository(session: null);
      await pumpLogin(tester, repository: repo);
      // Identitas driver tetap nomor HP, bukan email, sesuai kontrak auth.
      expect(find.text('Nomor HP'), findsOneWidget);
      expect(find.textContaining('Email'), findsNothing);
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('driver-phone-input')),
      );
      expect(field.keyboardType, TextInputType.phone);
      expect(field.autofillHints, contains(AutofillHints.telephoneNumber));
    });

    testWidgets('15. pesan error aman tanpa exception mentah', (tester) async {
      final repo = FakeDriverRepository(
        session: null,
        currentError: const DriverApiException(
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Nomor HP atau password salah',
          statusCode: 401,
        ),
      );
      await pumpLogin(tester, repository: repo);
      // Tidak ada jejak exception mentah pada layar login.
      expect(find.textContaining('Exception'), findsNothing);
      expect(find.textContaining('#0'), findsNothing);
      expect(find.textContaining('DioException'), findsNothing);
    });
  });

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
      // Diperiksa lewat widget layar login, bukan judulnya. Yang dijamin test
      // ini adalah kembalinya pengguna ke login — bukan teks judul tertentu.
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-login-button')), findsOneWidget);
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

    testWidgets(
        'profile required, pending, suspended, rejected, inactive tampil aman',
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
        'Akses driver dihentikan': const DriverApiException(
          code: 'RIDE_DRIVER_SUSPENDED',
          message: 'Akses driver sedang dihentikan.',
          statusCode: 403,
        ),
        'Pengajuan driver tidak dapat dilanjutkan.': const DriverApiException(
          code: 'RIDE_DRIVER_REJECTED',
          message: 'Pengajuan driver tidak dapat dilanjutkan.',
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

    testWidgets('login gagal 401 tidak membuka workspace', (tester) async {
      // Penjaga ini sebelumnya tidak diuji: yang teruji hanya sesi tidak sah
      // saat restore, bukan login yang ditolak server. Mutation testing
      // membuktikan status login gagal dapat diubah menjadi active tanpa satu
      // test pun gagal.
      final repo = FakeDriverRepository(
        session: null,
        loginError: const DriverApiException(
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Nomor HP atau password salah.',
          statusCode: 401,
        ),
      );
      await pumpDriver(tester, repo);

      await tester.tap(find.byKey(const ValueKey('driver-login-button')));
      await tester.pumpAndSettle();

      expect(repo.loginCalls, 1);
      // Workspace tidak boleh terbuka dalam bentuk apa pun.
      expect(find.text('Ketersediaan'), findsNothing);
      expect(find.byType(AvailabilityCard), findsNothing);
      expect(find.byType(DriverHomeScreen), findsNothing);
      // Pesan aman tanpa exception mentah.
      expect(find.textContaining('Exception'), findsNothing);
      expect(find.textContaining('#0'), findsNothing);
    });

    testWidgets('login gagal 500 juga tidak membuka workspace', (tester) async {
      final repo = FakeDriverRepository(
        session: null,
        loginError: const DriverApiException(
          code: 'INTERNAL',
          message: 'Terjadi gangguan. Silakan coba lagi.',
          statusCode: 500,
        ),
      );
      await pumpDriver(tester, repo);

      await tester.tap(find.byKey(const ValueKey('driver-login-button')));
      await tester.pumpAndSettle();

      expect(repo.loginCalls, 1);
      expect(find.byType(DriverHomeScreen), findsNothing);
      expect(find.text('Ketersediaan'), findsNothing);
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

    testWidgets('stale token saat refresh mengunci workspace tanpa bypass',
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
      expect(find.byKey(const ValueKey('session-expired')), findsOneWidget);
      expect(find.text('Ketersediaan'), findsNothing);
      expect(find.textContaining('DEMO_ACCESS'), findsNothing);
      expect(find.textContaining('TEST_ACCESS'), findsNothing);
    });

    testWidgets(
        'H1: profileRequired menampilkan jalur pengajuan (dokumen + form)',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'RIDE_DRIVER_PROFILE_REQUIRED',
          message: 'Profil driver belum tersedia. Hubungi admin TapGo.',
          statusCode: 403,
        ),
      );
      await pumpDriver(tester, repo);

      expect(find.byKey(const ValueKey('profile-required')), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('driver-application-form')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(
        find.byKey(const ValueKey('driver-application-form')),
        findsOneWidget,
      );
      // Dokumen belum lengkap -> tombol kirim terkunci.
      final submit = tester.widget<FilledButton>(
        find.byKey(const ValueKey('driver-application-submit')),
      );
      expect(submit.onPressed, isNull);
    });

    testWidgets(
        'H1: dokumen lengkap + plat valid mengirim pengajuan dan menampilkan status',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        ),
      );
      // Lengkapi keempat dokumen lewat kontrak repository yang sama.
      for (final kind in DriverDocumentKind.values) {
        await repo.uploadDocument(
          kind: kind,
          bytes: Uint8List.fromList([1, 2, 3]),
          contentType: 'image/png',
        );
      }
      await pumpDriver(tester, repo);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('driver-application-plate')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.enterText(
        find.byKey(const ValueKey('driver-application-plate')),
        'B 1234 UJI',
      );
      await tester.tap(find.byKey(const ValueKey('driver-application-submit')));
      await tester.pumpAndSettle();

      expect(repo.submitCalls, 1);
      expect(repo.submittedForms.single['plateNumber'], 'B 1234 UJI');
      expect(
        find.byKey(const ValueKey('driver-application-open')),
        findsOneWidget,
      );
      expect(find.text('Pengajuan #1'), findsOneWidget);
    });

    testWidgets('H1: pengajuan terbuka dapat ditarik lewat dialog konfirmasi',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        ),
        applicationInfo: const DriverApplicationInfo(
          id: 'fake-application',
          cycleNumber: 1,
          status: DriverApplicationStatus.submitted,
        ),
      );
      await pumpDriver(tester, repo);

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('driver-application-withdraw')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tapReachable(
          tester, find.byKey(const ValueKey('driver-application-withdraw')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Tarik'));
      await tester.pumpAndSettle();

      expect(repo.withdrawCalls, 1);
      expect(find.byKey(const ValueKey('driver-application-form')),
          findsOneWidget);
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

    testWidgets('lifecycle resume melakukan tepat satu refresh current ride',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverToPickup),
      );
      await pumpDriver(tester, repo);
      final controller = ProviderScope.containerOf(
        tester.element(find.byType(DriverShell)),
      ).read(driverControllerProvider.notifier);
      final beforeResume = repo.currentRideCalls;
      controller.didChangeAppLifecycleState(AppLifecycleState.paused);
      controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(repo.currentRideCalls, beforeResume + 1);
      expect(find.text('Perjalanan Aktif'), findsOneWidget);
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

    testWidgets('demo repository tetap zero network setelah interaksi',
        (tester) async {
      final repo =
          DemoDriverRepository(initialScenario: DriverScenario.offerAvailable);
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        buildTestableDriverApp(
          repository: repo,
          scenario: DriverScenario.offerAvailable,
        ),
      );
      await tester.pumpAndSettle();
      await tapReachable(
          tester, find.byKey(const ValueKey('offer-RIDE-DEMO-001')));
      await tester.pumpAndSettle();
      await tapReachable(
          tester, find.byKey(const ValueKey('accept-offer-button')));
      await tester.pumpAndSettle();
      expect(repo.networkCalls, 0);
      expect(find.text('Perjalanan Aktif'), findsOneWidget);
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
    this.applicationInfo,
    this.availability = DriverAvailability.offline,
    this.currentError,
    this.offersError,
    this.acceptError,
    this.availabilityCompleter,
    this.acceptCompleter,
    this.loginCompleter,
    this.loginError,
  });

  DriverSession? session;
  DriverRide? current;
  List<DriverRide> offerItems;
  DriverAvailability availability;
  DriverApiException? currentError;
  Object? offersError;
  DriverApiException? acceptError;
  DriverApiException? loginError;
  Completer<DriverAvailability>? availabilityCompleter;
  Completer<DriverRide>? acceptCompleter;
  Completer<DriverSession>? loginCompleter;
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
  int currentRideCalls = 0;
  int offersCalls = 0;
  final availabilityRequests = <DriverAvailability>[];

  @override
  Future<DriverSession?> restoreSession() async => session;

  @override
  Future<DriverSession> login(
      {required String phone, required String password}) async {
    loginCalls += 1;
    if (loginError != null) {
      throw loginError!;
    }
    // Bila test menyediakan completer, login ditahan sehingga state loading
    // benar-benar dapat diamati.
    if (loginCompleter != null) {
      final result = await loginCompleter!.future;
      session = result;
      return result;
    }
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
    offersCalls += 1;
    if (offersError != null) throw offersError!;
    return offerItems;
  }

  @override
  Future<DriverRide?> currentRide() async {
    currentRideCalls += 1;
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

  /* ── Dokumen verifikasi mitra ───────────────────────────────────────── */

  List<DriverDocumentSummary> documentItems = const [];
  Object? documentsError;
  Object? uploadError;
  final List<DriverDocumentKind> uploadedKinds = <DriverDocumentKind>[];
  final List<int> uploadedSizes = <int>[];

  @override
  Future<List<DriverDocumentSummary>> documents() async {
    if (documentsError != null) throw documentsError!;
    return documentItems;
  }

  @override
  Future<List<DriverDocumentSummary>> uploadDocument({
    required DriverDocumentKind kind,
    required Uint8List bytes,
    required String contentType,
  }) async {
    if (uploadError != null) throw uploadError!;
    uploadedKinds.add(kind);
    uploadedSizes.add(bytes.length);
    final now = DateTime.now();
    documentItems = [
      ...documentItems.where((item) => item.kind != kind),
      DriverDocumentSummary(
        kind: kind,
        review: DriverDocumentReview.pending,
        available: true,
        uploadedAt: now,
        expiresAt: now.add(const Duration(hours: 24)),
        sizeBytes: bytes.length,
      ),
    ];
    return documentItems;
  }

  DriverApplicationInfo? applicationInfo;
  Object? applicationError;
  Object? submitError;
  Object? withdrawError;
  int submitCalls = 0;
  int withdrawCalls = 0;
  final List<Map<String, String?>> submittedForms = [];

  DriverApplicationSnapshot _snapshot() => DriverApplicationSnapshot(
        application: applicationInfo,
        documentsComplete:
            documentItems.length == DriverDocumentKind.values.length,
        vehiclePlateMasked: applicationInfo == null ? null : 'B 1234 ***',
      );

  @override
  Future<DriverApplicationSnapshot> myApplication() async {
    if (applicationError != null) throw applicationError!;
    return _snapshot();
  }

  @override
  Future<DriverApplicationSnapshot> submitApplication({
    required String serviceType,
    required String plateNumber,
    String? brand,
    String? model,
    String? color,
  }) async {
    if (submitError != null) throw submitError!;
    submitCalls += 1;
    submittedForms.add({
      'serviceType': serviceType,
      'plateNumber': plateNumber,
      'brand': brand,
      'model': model,
      'color': color,
    });
    applicationInfo = const DriverApplicationInfo(
      id: 'fake-application',
      cycleNumber: 1,
      status: DriverApplicationStatus.submitted,
    );
    return _snapshot();
  }

  @override
  Future<DriverApplicationSnapshot> withdrawApplication() async {
    if (withdrawError != null) throw withdrawError!;
    withdrawCalls += 1;
    applicationInfo = null;
    return _snapshot();
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
