import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:tapgo_driver_app/main.dart';

void main() {
  // Pilihan bunyi dan tema tersimpan di SharedPreferences; tanpa ini panggilan
  // platformnya tidak pernah selesai di bawah waktu palsu flutter_test.
  setUp(() => SharedPreferences.setMockInitialValues({}));

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
    test(
        'isAuthFailure hanya true untuk 401/AUTH_REQUIRED, bukan status '
        'kapabilitas driver', () {
      const authFailures = [
        DriverApiException(
          code: 'AUTH_REQUIRED',
          message: 'x',
          statusCode: 401,
        ),
        DriverApiException(code: 'ANYTHING', message: 'x', statusCode: 401),
        DriverApiException(code: 'AUTH_REQUIRED', message: 'x'),
      ];
      const capabilityOnly = [
        DriverApiException(code: 'RIDE_DRIVER_PROFILE_REQUIRED', message: 'x'),
        DriverApiException(code: 'RIDE_DRIVER_NOT_ACTIVE', message: 'x'),
        DriverApiException(code: 'RIDE_DRIVER_ACCOUNT_INACTIVE', message: 'x'),
      ];
      for (final error in authFailures) {
        expect(error.isAuthFailure, isTrue, reason: error.code);
        expect(error.isAuthOrCapability, isTrue, reason: error.code);
      }
      for (final error in capabilityOnly) {
        expect(error.isAuthFailure, isFalse, reason: error.code);
        expect(error.isAuthOrCapability, isTrue, reason: error.code);
      }
    });

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

    testWidgets(
        'login ditolak 401 INVALID_CREDENTIALS tetap di layar login dengan pesan Indonesia',
        (tester) async {
      // Regresi APK +4 (4 Okt 2026): 401 saat login dipetakan menjadi
      // sessionExpired sehingga driver dilempar ke layar "Sesi berakhir"
      // alih-alih tetap di form login dengan pesan yang bisa ditindaklanjuti.
      // Kode di bawah adalah kode NYATA backend (AuthService.ts), bukan
      // karangan, supaya pemetaan pesan diuji pada masukan sebenarnya.
      final repo = FakeDriverRepository(
        session: null,
        loginError: const DriverApiException(
          code: 'INVALID_CREDENTIALS',
          message: 'Nomor HP atau password salah.',
          statusCode: 401,
        ),
      );
      await pumpDriver(tester, repo);

      await tester.tap(find.byKey(const ValueKey('driver-login-button')));
      await tester.pumpAndSettle();

      expect(repo.loginCalls, 1);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-login-button')), findsOneWidget);
      expect(find.text('Sesi berakhir'), findsNothing);
      expect(find.text('Nomor HP atau password salah.'), findsOneWidget);
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
        find.byKey(const ValueKey('start-application-wizard')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('start-application-wizard')));
      await tester.pumpAndSettle();

      // Halaman pertama = Pernyataan: tombol Lanjut terkunci sampai naskah dibaca dan disetujui.
      final nextKey = find.byKey(const ValueKey('driver-application-wizard-next'));
      expect(tester.widget<FilledButton>(nextKey).onPressed, isNull);
      await readDeclarationToEnd(tester);
      await tester.tap(find.byKey(const ValueKey('wizard-declaration-checkbox')));
      await tester.pumpAndSettle();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();
      // Halaman kedua = Upload Dokumen: dokumen belum lengkap -> Lanjut terkunci.
      expect(find.byKey(const ValueKey('driver-terms')), findsNothing);
      expect(tester.widget<FilledButton>(nextKey).onPressed, isNull);
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
      // Lengkapi kelima dokumen (termasuk SKCK) lewat kontrak repository
      // yang sama — wizard membaginya ke halaman 1 dan halaman 4, tapi
      // kelengkapannya tetap dicek dari data yang sama.
      for (final kind in DriverDocumentKind.values) {
        await repo.uploadDocument(
          kind: kind,
          bytes: Uint8List.fromList([1, 2, 3]),
          contentType: 'image/png',
        );
      }
      await pumpDriver(tester, repo);

      final nextKey = find.byKey(const ValueKey('driver-application-wizard-next'));
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('start-application-wizard')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('start-application-wizard')));
      await tester.pumpAndSettle();

      // Halaman 1 — Pernyataan (di awal, sebelum unggah dokumen).
      await readDeclarationToEnd(tester);
      await tester.tap(find.byKey(const ValueKey('wizard-declaration-checkbox')));
      await tester.pumpAndSettle();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();

      // Halaman 2 — Upload Dokumen: sudah lengkap lewat repository di atas.
      await tester.tap(nextKey);
      await tester.pumpAndSettle();

      // Halaman 3 — Data Diri: seluruh field wajib diisi, tidak ada opsional.
      await tester.enterText(
        find.byKey(const ValueKey('wizard-full-name')),
        'Budi Santoso',
      );
      await tester.enterText(
        find.byKey(const ValueKey('wizard-address')),
        'Jl. Melati No. 5, Jakarta',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('wizard-date-of-birth')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('wizard-emergency-name')),
        'Siti Santoso',
      );
      await tester.enterText(
        find.byKey(const ValueKey('wizard-emergency-phone')),
        '081234567890',
      );
      await tester.pump();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();

      // Halaman 4 — Data Kendaraan.
      await tester.enterText(
        find.byKey(const ValueKey('wizard-plate')),
        'B 1234 UJI',
      );
      await tester.pump();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();

      // Halaman 5 — Upload Data Tambahan (SKCK): sudah lengkap; Kirim Pengajuan.
      await tester.tap(nextKey);
      await tester.pumpAndSettle();

      expect(repo.submitCalls, 1);
      expect(repo.submittedForms.single['plateNumber'], 'B 1234 UJI');
      expect(repo.submittedForms.single['fullName'], 'Budi Santoso');
      expect(repo.submittedForms.single['declarationAccepted'], isTrue);
      expect(
        find.byKey(const ValueKey('driver-application-open')),
        findsOneWidget,
      );
      expect(find.text('Pengajuan #1'), findsOneWidget);
    });

    testWidgets(
        'pernyataan: naskah lengkap tampil, kotak persetujuan terkunci sampai naskah digulir habis, dan versi naskah ikut terkirim',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        ),
      );
      for (final kind in DriverDocumentKind.values) {
        await repo.uploadDocument(
          kind: kind,
          bytes: Uint8List.fromList([1, 2, 3]),
          contentType: 'image/png',
        );
      }
      await pumpDriver(tester, repo);
      final nextKey = find.byKey(const ValueKey('driver-application-wizard-next'));
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('start-application-wizard')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('start-application-wizard')));
      await tester.pumpAndSettle();

      // Pernyataan adalah halaman PERTAMA. Terkunci: belum digulir, kotak tidak bisa dicentang dan Lanjut mati.
      expect(find.byKey(const ValueKey('driver-terms')), findsOneWidget);
      expect(find.byKey(const ValueKey('wizard-declaration-scroll-hint')), findsOneWidget);
      final locked = tester.widget<CheckboxListTile>(
        find.byKey(const ValueKey('wizard-declaration-checkbox'), skipOffstage: false),
      );
      expect(locked.onChanged, isNull);
      expect(tester.widget<FilledButton>(nextKey).onPressed, isNull);

      await readDeclarationToEnd(tester);
      expect(find.byKey(const ValueKey('wizard-declaration-scroll-hint')), findsNothing);
      final unlocked = tester.widget<CheckboxListTile>(
        find.byKey(const ValueKey('wizard-declaration-checkbox')),
      );
      expect(unlocked.onChanged, isNotNull);

      await tester.tap(find.byKey(const ValueKey('wizard-declaration-checkbox')));
      await tester.pumpAndSettle();
      await tester.tap(nextKey); // -> Upload Dokumen (lengkap)
      await tester.pumpAndSettle();
      await tester.tap(nextKey); // -> Data Diri
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('wizard-full-name')), 'Budi Santoso');
      await tester.enterText(find.byKey(const ValueKey('wizard-address')), 'Jl. Melati No. 5');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('wizard-date-of-birth')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('wizard-emergency-name')), 'Siti');
      await tester.enterText(find.byKey(const ValueKey('wizard-emergency-phone')), '081234567890');
      await tester.pump();
      await tester.tap(nextKey); // -> Data Kendaraan
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('wizard-plate')), 'B 1234 UJI');
      await tester.pump();
      await tester.tap(nextKey); // -> SKCK
      await tester.pumpAndSettle();
      await tester.tap(nextKey); // Kirim Pengajuan
      await tester.pumpAndSettle();
      expect(repo.submitCalls, 1);
      expect(repo.submittedForms.single['declarationVersion'], kDriverTermsVersion);
    });

    testWidgets(
        'H1: pengajuan gagal dengan pesan yang memuat kata "terkirim" tidak menutup wizard',
        (tester) async {
      // Keberhasilan dulu dideteksi lewat message.contains('terkirim'), jadi
      // pesan galat yang kebetulan memuat kata itu menutup wizard seolah sukses
      // dan data yang sudah diisi hilang.
      final repo = FakeDriverRepository(
        session: demoSession,
        currentError: const DriverApiException(
          code: 'RIDE_DRIVER_NOT_ACTIVE',
          message: 'Akun driver belum aktif untuk menerima perjalanan.',
          statusCode: 403,
        ),
      )..submitError = const DriverApiException(
          code: 'SERVER_BUSY',
          message: 'Pengajuan belum terkirim. Silakan coba lagi.',
          statusCode: 503,
        );
      for (final kind in DriverDocumentKind.values) {
        await repo.uploadDocument(
          kind: kind,
          bytes: Uint8List.fromList([1, 2, 3]),
          contentType: 'image/png',
        );
      }
      await pumpDriver(tester, repo);

      final nextKey = find.byKey(const ValueKey('driver-application-wizard-next'));
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('start-application-wizard')),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('start-application-wizard')));
      await tester.pumpAndSettle();
      await readDeclarationToEnd(tester);
      await tester.tap(find.byKey(const ValueKey('wizard-declaration-checkbox')));
      await tester.pumpAndSettle();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('wizard-full-name')), 'Budi Santoso');
      await tester.enterText(find.byKey(const ValueKey('wizard-address')), 'Jl. Melati No. 5');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('wizard-date-of-birth')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('wizard-emergency-name')), 'Siti');
      await tester.enterText(find.byKey(const ValueKey('wizard-emergency-phone')), '081234567890');
      await tester.pump();
      await tester.tap(nextKey);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('wizard-plate')), 'B 1234 UJI');
      await tester.pump();
      await tester.tap(nextKey); // -> SKCK
      await tester.pumpAndSettle();
      await tester.tap(nextKey); // Kirim Pengajuan (gagal)
      await tester.pumpAndSettle();

      expect(repo.submitCalls, 0);
      // Wizard tetap terbuka di halaman terakhir; pengajuan tidak dianggap terkirim.
      expect(nextKey, findsOneWidget);
      expect(find.byKey(const ValueKey('driver-application-open')), findsNothing);
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
      expect(find.byKey(const ValueKey('start-application-wizard')),
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
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(available: true));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      expect(repo.availabilityRequests, [DriverAvailability.online]);
      completer.complete(DriverAvailability.online);
      await tester.pumpAndSettle();
      expect(find.text('Status: Online'), findsOneWidget);
    });

    testWidgets(
        'checkAndGoOnline: status DISABLED langsung online tanpa membuka layar verifikasi wajah',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..faceCheckStatus = DriverFaceCheckStatus.disabled;
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(available: true));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(find.byType(DriverFaceCheckScreen), findsNothing);
      expect(repo.availabilityRequests, [DriverAvailability.online]);
      expect(find.text('Status: Online'), findsOneWidget);
    });

    testWidgets(
        'checkAndGoOnline: status PENDING membuka layar verifikasi wajah (bukan langsung online)',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..faceCheckStatus = DriverFaceCheckStatus.pending;
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(available: true));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      // BUKAN pumpAndSettle: DriverFaceCheckScreen di luar mode demo memanggil
      // availableCameras() sungguhan, yang tidak pernah selesai di lingkungan
      // widget test (tidak ada platform channel kamera) — settle tidak akan
      // pernah tercapai. Beberapa pump bertahap cukup untuk memastikan
      // navigasinya terjadi, tanpa menunggu inisialisasi kamera selesai.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(find.byType(DriverFaceCheckScreen), findsOneWidget);
      expect(repo.availabilityRequests, isEmpty);
    });

    testWidgets(
        'checkAndGoOnline: GPS mati menampilkan pesan dan tombol "Buka Pengaturan GPS", tidak online',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(
            available: false,
            availabilityStatus: DriverLocationAvailability.serviceDisabled,
          ));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(repo.availabilityRequests, isEmpty);
      expect(find.textContaining('GPS/Lokasi HP Anda sedang mati'), findsOneWidget);
      expect(find.byKey(const ValueKey('open-location-settings')), findsOneWidget);
      expect(find.text('Buka Pengaturan GPS'), findsOneWidget);
    });

    testWidgets(
        'checkAndGoOnline: izin lokasi ditolak permanen menampilkan tombol "Buka Pengaturan Lokasi", tidak online',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(
            available: false,
            availabilityStatus: DriverLocationAvailability.permissionDeniedForever,
          ));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(repo.availabilityRequests, isEmpty);
      expect(find.textContaining('ditolak permanen'), findsOneWidget);
      expect(find.text('Buka Pengaturan Lokasi'), findsOneWidget);
    });

    testWidgets(
        'izin lokasi hilang DI TENGAH sesi online memunculkan peringatan, bukan diam total',
        (tester) async {
      // Regresi Owner 29 Sep 2026: driver online >5 menit, polling tawaran
      // terus berjalan normal, TAPI tidak ada satu pun lokasi terkirim
      // sepanjang sesi itu — preflight di checkAndGoOnline() hanya memeriksa
      // SEKALI saat tombol ditekan; izin yang hilang SETELAH itu (dicabut,
      // GPS dimatikan) tidak pernah terdeteksi ulang, driver terlihat online
      // tanpa tahu dirinya sebenarnya tidak terlihat oleh sistem pencocokan.
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true);
      await pumpDriver(tester, repo, locationPort: location);

      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(repo.availabilityRequests, [DriverAvailability.online]);
      expect(find.text('Buka Pengaturan Lokasi'), findsNothing);

      // Lewati beberapa detak (5 detik/detak, dikirim tiap detak ke-3 saat
      // idle = 15 detik) sementara lokasi MASIH tersedia — lokasi terkirim
      // normal, tidak ada peringatan.
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(seconds: 5));
      }
      final sentWhileAvailable = location.sendCalls;
      expect(sentWhileAvailable, greaterThan(0));
      expect(find.text('Buka Pengaturan Lokasi'), findsNothing);

      // Izin dicabut PERSIS seperti yang terjadi di lapangan — bukan lewat
      // toggle Online lagi (yang tidak pernah ditekan ulang oleh driver),
      // tapi lewat detak berikutnya yang sekarang menemukan status berubah.
      location.availabilityStatus = DriverLocationAvailability.permissionDeniedForever;
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(seconds: 5));
      }
      expect(location.sendCalls, sentWhileAvailable,
          reason: 'tidak boleh mencoba kirim lokasi saat sudah diketahui tidak tersedia');
      expect(find.text('Buka Pengaturan Lokasi'), findsOneWidget);
      expect(find.byKey(const ValueKey('open-location-settings')), findsOneWidget);

      // Izin dipulihkan (driver membuka pengaturan lalu kembali) — peringatan
      // hilang lagi dan pengiriman lokasi berlanjut, tanpa perlu toggle ulang.
      location.availabilityStatus = DriverLocationAvailability.available;
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(seconds: 5));
      }
      expect(find.text('Buka Pengaturan Lokasi'), findsNothing);
      expect(location.sendCalls, greaterThan(sentWhileAvailable));
    });

    testWidgets(
        'loading, empty, error, retry, dan raw exception aman',
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
      await pumpDriverOrders(tester, repo);
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
      await pumpDriverOrders(tester, repo);
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

    testWidgets(
        'menolak tawaran berhasil menampilkan konfirmasi, bukan diam total',
        (tester) async {
      // Regresi Owner 29 Sep 2026: "ketika driver tolak order tidak ada
      // pesan apapun atau pemberitahuan apapun" — sheet tawaran sebelumnya
      // hanya tertutup diam-diam saat berhasil, driver tidak tahu pasti
      // penolakannya terkirim. Sengaja TIDAK menguji sisi penumpang di
      // sini: menolak SATU tawaran tidak mengubah status order (order
      // tetap dicari driver lain) — itu bukan peristiwa yang perlu
      // diketahui penumpang.
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [demoOffer],
      );
      await pumpDriverOrders(tester, repo);
      final offerTile = find.byKey(const ValueKey('offer-RIDE-DEMO-001'));
      await tapReachable(tester, offerTile);
      await tester.pumpAndSettle();
      await tapReachable(
          tester, find.byKey(const ValueKey('reject-offer-button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(repo.rejectCalls, 1);
      expect(find.text('Tawaran ditolak.'), findsOneWidget);
    });

    testWidgets('catatan lokasi jemput tampil di detail tawaran dan perjalanan aktif',
        (tester) async {
      const offerWithNote = DriverRide(
        reference: 'RIDE-DEMO-001',
        serviceType: 'MOTORCYCLE',
        status: RideStatus.searchingDriver,
        pickupAddress: 'LOKASI_DEMO_A',
        dropoffAddress: 'LOKASI_DEMO_B',
        pickupNote: 'Di depan minimarket, bukan gang sebelah',
        distanceMeters: 2500,
        durationSeconds: 600,
        totalFare: 9000,
      );
      final accept = Completer<DriverRide>();
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [offerWithNote],
        acceptCompleter: accept,
      );
      await pumpDriverOrders(tester, repo);
      await tapReachable(
          tester, find.byKey(const ValueKey('offer-RIDE-DEMO-001')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('offer-pickup-note')), findsOneWidget);
      expect(
        find.text('Catatan: Di depan minimarket, bukan gang sebelah'),
        findsOneWidget,
      );

      await tapReachable(
          tester, find.byKey(const ValueKey('accept-offer-button')));
      accept.complete(const DriverRide(
        reference: 'RIDE-DEMO-001',
        serviceType: 'MOTORCYCLE',
        status: RideStatus.driverToPickup,
        pickupAddress: 'LOKASI_DEMO_A',
        dropoffAddress: 'LOKASI_DEMO_B',
        pickupNote: 'Di depan minimarket, bukan gang sebelah',
        distanceMeters: 2500,
        durationSeconds: 600,
        totalFare: 9000,
      ));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('active-ride-pickup-note')), findsOneWidget);
      expect(
        find.text('Catatan: Di depan minimarket, bukan gang sebelah'),
        findsOneWidget,
      );
    });
  });

  group('Peta beranda langsung ke posisi driver', () {
    LatLng mapCenter(WidgetTester tester) => tester
        .widget<FlutterMap>(find.byKey(const ValueKey('driver-home-map')))
        .mapController!
        .camera
        .center;
    const jakarta = LatLng(-6.1754, 106.8272);

    testWidgets('stream yang emit setelah frame pertama memindahkan pusat dari Jakarta ke titik itu',
        (tester) async {
      // Uji HP +7: peta hanya memakai initialCenter sekali; titik pertama dari
      // stream (distanceFilter 10 m) tidak pernah memindahkan kamera.
      final fixes = StreamController<(double, double)>.broadcast();
      addTearDown(fixes.close);
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true, fixes: fixes.stream);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      expect(mapCenter(tester).latitude, closeTo(jakarta.latitude, 1e-6));

      fixes.add((-6.9175, 107.6191));
      await tester.pump();
      await tester.pump();

      expect(mapCenter(tester).latitude, closeTo(-6.9175, 1e-6));
      expect(mapCenter(tester).longitude, closeTo(107.6191, 1e-6));
      expect(find.byType(MarkerLayer), findsOneWidget);
    });

    testWidgets('satu posisi saat layar dibuka memindahkan kamera tanpa menunggu gerakan 10 meter',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true)
        ..fix = const DriverLocationFix(lat: -7.2575, lng: 112.7521, accuracyMeters: 10);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();

      expect(mapCenter(tester).latitude, closeTo(-7.2575, 1e-6));
      expect(mapCenter(tester).longitude, closeTo(112.7521, 1e-6));
    });

    testWidgets('pembaruan stream berikutnya juga memindahkan kamera', (tester) async {
      final fixes = StreamController<(double, double)>.broadcast();
      addTearDown(fixes.close);
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true, fixes: fixes.stream)
        ..fix = const DriverLocationFix(lat: -7.2575, lng: 112.7521, accuracyMeters: 10);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();

      fixes.add((-7.2600, 112.7600));
      await tester.pump();
      await tester.pump();

      expect(mapCenter(tester).latitude, closeTo(-7.2600, 1e-6));
      expect(mapCenter(tester).longitude, closeTo(112.7600, 1e-6));
    });

    testWidgets('tanpa GPS: peta tetap di Jakarta dan tanpa marker', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: false);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();

      expect(mapCenter(tester).latitude, closeTo(jakarta.latitude, 1e-6));
      expect(mapCenter(tester).longitude, closeTo(jakarta.longitude, 1e-6));
      expect(find.byType(MarkerLayer), findsNothing);
    });
  });

  group('Sampai di tujuan tidak menyelesaikan perjalanan sendiri', () {
    testWidgets('GPS tiba di titik tujuan: tombol tetap "Selesaikan Perjalanan", complete tidak dipanggil',
        (tester) async {
      final fixes = StreamController<(double, double)>.broadcast();
      addTearDown(fixes.close);
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRideWithLocation(RideStatus.inTrip),
        availability: DriverAvailability.busy,
      );
      final location = RecordingLocationPort(available: true, fixes: fixes.stream);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();

      // Posisi driver tepat di titik tujuan, lalu polling berjalan.
      fixes.add((-6.1854, 106.8372));
      await tester.pump(const Duration(seconds: 13));
      await tester.pump(const Duration(seconds: 13));

      expect(repo.completeCalls, 0, reason: 'tidak boleh selesai dari jarak GPS');
      await tester.tap(find.byIcon(Icons.receipt_long_rounded));
      await tester.pumpAndSettle();
      expect(find.text('Selesaikan Perjalanan'), findsOneWidget);
      expect(repo.completeCalls, 0);
    });
  });

  group('Status beranda mengikuti server (bukan memori)', () {
    testWidgets('buka ulang saat server ONLINE: kartu Online, tanpa memanggil POST',
        (tester) async {
      // Uji HP +7: setelah aplikasi dibuka ulang kartu menampilkan Offline
      // padahal server ONLINE, karena availability hanya hidup di memori klien.
      final repo = FakeDriverRepository(
          session: demoSession, availability: DriverAvailability.online);
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();

      expect(find.text('Status: Online'), findsOneWidget);
      expect(find.text('Status: Offline'), findsNothing);
      expect(repo.availabilityRequests, isEmpty,
          reason: 'jangan memanggil POST saat dibuka: onlineSince dan verifikasi wajah tidak boleh direset');
      expect(location.startTrackingCalls, greaterThan(0),
          reason: 'ONLINE: pelacakan lokasi menyala');
    });

    testWidgets('server OFFLINE: kartu Offline dan pelacakan tidak menyala',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();

      expect(find.text('Status: Offline'), findsOneWidget);
      expect(location.startTrackingCalls, 0);
    });

    testWidgets('server BUSY tanpa perjalanan aktif: kartu Online, tanpa POST',
        (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession, availability: DriverAvailability.busy);
      await pumpDriver(tester, repo);

      expect(find.text('Status: Online'), findsOneWidget);
      expect(find.text('Status: Dalam Perjalanan'), findsNothing);
      expect(repo.availabilityRequests, isEmpty);
    });

    testWidgets('perjalanan aktif: kartu menampilkan status perjalanan, bukan label availability',
        (tester) async {
      for (final entry in {
        RideStatus.driverToPickup: 'Menuju Jemput',
        RideStatus.driverArrived: 'Tiba di Jemput',
        RideStatus.inTrip: 'Dalam Perjalanan',
      }.entries) {
        final repo = FakeDriverRepository(
          session: demoSession,
          current: demoRide(entry.key),
          availability: DriverAvailability.busy,
        );
        await pumpDriver(tester, repo);
        expect(find.text('Status: ${entry.value}'), findsOneWidget,
            reason: '${entry.key}');
      }
    });

    testWidgets('setelah complete berhasil: kartu kembali ke hasil server (Online), tidak tetap "Dalam Perjalanan"',
        (tester) async {
      // Uji HP +7: setelah complete kartu tetap "Dalam Perjalanan" karena klien
      // mempertahankan busy dari accept.
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
        availability: DriverAvailability.busy,
      );
      await pumpDriver(tester, repo);
      expect(find.text('Status: Dalam Perjalanan'), findsOneWidget);

      // Tombol perjalanan ada di tab Pesanan; kartu status di Beranda.
      await tester.tap(find.byIcon(Icons.receipt_long_rounded));
      await tester.pumpAndSettle();
      await tapReachable(tester, find.byKey(const ValueKey('trip-primary-action')));
      await tester.pumpAndSettle();
      expect(repo.completeCalls, 1);
      // Tepat setelah complete (sebelum pindah tab, yang memicu refresh): state
      // sudah selaras dengan server, bukan busy dari accept.
      expect(
        ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
            .read(driverControllerProvider)
            .availability,
        DriverAvailability.online,
      );
      await tester.tap(find.byIcon(Icons.home_rounded));
      await tester.pumpAndSettle();

      expect(find.text('Status: Online'), findsOneWidget);
      expect(find.text('Status: Dalam Perjalanan'), findsNothing);
      expect(repo.availabilityRequests, isEmpty);
    });

    testWidgets('server lama tanpa GET availability (404): workspace tetap terbuka, tidak error',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..availabilityGetError = const DriverApiException(
          code: 'ROUTE_NOT_FOUND',
          message: 'Fitur ini belum tersedia di server.',
          statusCode: 404,
        );
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(available: true));

      expect(find.byKey(const ValueKey('network-error')), findsNothing);
      expect(find.text('Status: Offline'), findsOneWidget);
      // Toggle manual tetap berjalan seperti sebelumnya.
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(find.text('Status: Online'), findsOneWidget);
    });
  });

  group('Popup order masuk (OfferDetailSheet otomatis)', () {
    DriverRide offerRide(String reference, {DateTime? updatedAt}) => DriverRide(
          reference: reference,
          serviceType: 'MOTORCYCLE',
          status: RideStatus.searchingDriver,
          pickupAddress: 'JEMPUT_$reference',
          dropoffAddress: 'TUJUAN_$reference',
          distanceMeters: 2500,
          durationSeconds: 600,
          totalFare: 9000,
          updatedAt: updatedAt,
        );

    DriverController controllerOf(WidgetTester tester) =>
        ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
            .read(driverControllerProvider.notifier);

    String? selectedRef(WidgetTester tester) =>
        ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
            .read(driverControllerProvider)
            .selectedOffer
            ?.reference;

    Future<void> poll(WidgetTester tester) async {
      await tester.pump(const Duration(seconds: 12));
      await tester.pump(const Duration(milliseconds: 50));
    }

    testWidgets('tawaran baru lewat polling 12 detik membuka sheet tanpa ketukan',
        (tester) async {
      // Sebelumnya order masuk hanya menambah daftar; sheet baru muncul bila
      // driver mengetuk OfferTile, sehingga driver yang tidak menatap daftar
      // tidak tahu ada order.
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      expect(find.byType(OfferDetailSheet), findsNothing);

      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);

      expect(selectedRef(tester), 'RID-A');
      expect(find.byType(OfferDetailSheet), findsOneWidget);
    });

    testWidgets('tawaran baru lewat push membuka sheet', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      expect(find.byType(OfferDetailSheet), findsNothing);

      repo.offerItems = [offerRide('RID-PUSH')];
      platform.foreground.add(const DriverPushMessage(
          title: 'Order baru',
          body: 'Ada penumpang di dekat Anda',
          data: {'type': 'ride_offer', 'rideReference': 'RID-PUSH'}));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(selectedRef(tester), 'RID-PUSH');
      expect(find.byType(OfferDetailSheet), findsOneWidget);
    });

    testWidgets('setelah closeOffer, tawaran yang sama tidak dibuka lagi',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');

      controllerOf(tester).closeOffer();
      await tester.pump();
      expect(find.byType(OfferDetailSheet), findsNothing);

      // Polling berikutnya, dan tawaran yang sempat hilang lalu muncul lagi.
      await poll(tester);
      expect(selectedRef(tester), isNull);
      repo.offerItems = [];
      await poll(tester);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      expect(selectedRef(tester), isNull);
      expect(find.byType(OfferDetailSheet), findsNothing);
    });

    testWidgets('tawaran yang ditolak tidak dibuka lagi, tawaran lain tetap dibuka',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      await controllerOf(tester).rejectSelectedOffer();
      await tester.pump();
      expect(selectedRef(tester), isNull);

      repo.offerItems = [];
      await poll(tester);
      repo.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);

      expect(selectedRef(tester), 'RID-B');
    });

    testWidgets('perjalanan aktif tidak membuka sheet', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);

      expect(selectedRef(tester), isNull);
      expect(find.byType(OfferDetailSheet), findsNothing);
    });

    testWidgets('beberapa tawaran baru bersamaan: yang paling baru dibuka',
        (tester) async {
      final older = DateTime.utc(2026, 10, 4, 10, 0);
      final newer = DateTime.utc(2026, 10, 4, 10, 5);
      for (final order in [
        [offerRide('RID-NEW', updatedAt: newer), offerRide('RID-OLD', updatedAt: older)],
        [offerRide('RID-OLD', updatedAt: older), offerRide('RID-NEW', updatedAt: newer)],
      ]) {
        final repo = FakeDriverRepository(session: demoSession);
        await pumpDriver(tester, repo);
        repo.offerItems = order;
        await poll(tester);
        expect(selectedRef(tester), 'RID-NEW',
            reason: 'urutan daftar: ${order.map((o) => o.reference)}');
      }
    });

    testWidgets('sheet yang sedang terbuka tidak diganti tawaran baru lain',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      repo.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);

      expect(selectedRef(tester), 'RID-A');
    });

    testWidgets(
        'closeOffer pada A langsung membuka B yang datang saat A terbuka, tanpa refresh tambahan',
        (tester) async {
      // Lubang +5: B masuk saat sheet A terbuka dan tersimpan di daftar; poll
      // berikutnya tidak lagi menganggap B baru, jadi B tidak pernah dibuka.
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');

      repo.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A', reason: 'sheet A tidak boleh diganti');

      final callsBefore = repo.offersCalls;
      controllerOf(tester).closeOffer();
      await tester.pump();

      expect(selectedRef(tester), 'RID-B');
      expect(find.byType(OfferDetailSheet), findsOneWidget);
      expect(repo.offersCalls, callsBefore, reason: 'tanpa refresh tambahan');
    });

    testWidgets('menolak A dengan berhasil langsung membuka B yang tertunda',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      repo.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');

      await controllerOf(tester).rejectSelectedOffer();
      await tester.pump();

      expect(selectedRef(tester), 'RID-B');
    });

    testWidgets('B yang sudah ditutup atau ditolak tidak dibuka lagi saat A ditutup',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      // B dibuka lalu ditutup.
      repo.offerItems = [offerRide('RID-B')];
      await poll(tester);
      controllerOf(tester).closeOffer();
      await tester.pump();
      // A datang, dibuka; B masih ada di daftar.
      repo.offerItems = [offerRide('RID-B'), offerRide('RID-A')];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');
      controllerOf(tester).closeOffer();
      await tester.pump();
      expect(selectedRef(tester), isNull);

      // B yang ditolak tidak kembali walau tertunda sebelumnya.
      final repo2 = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo2);
      repo2.offerItems = [offerRide('RID-A')];
      await poll(tester);
      repo2.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);
      await controllerOf(tester).rejectSelectedOffer(); // A ditolak, B terbuka
      await tester.pump();
      expect(selectedRef(tester), 'RID-B');
      await controllerOf(tester).rejectSelectedOffer(); // B ditolak
      await tester.pump();
      expect(selectedRef(tester), isNull);
      await poll(tester);
      expect(selectedRef(tester), isNull);
    });

    testWidgets('B yang sudah hilang dari daftar saat A ditutup tidak dibuka',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      repo.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);
      // B kedaluwarsa/diambil driver lain sebelum A ditutup.
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');

      controllerOf(tester).closeOffer();
      await tester.pump();

      expect(selectedRef(tester), isNull);
      expect(find.byType(OfferDetailSheet), findsNothing);
    });

    testWidgets('tawaran tertunda tidak membuka sheet selama ada perjalanan aktif',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerRide('RID-A')];
      await poll(tester);
      repo.offerItems = [offerRide('RID-A'), offerRide('RID-B')];
      await poll(tester);

      // A diterima: perjalanan aktif; B yang tertunda tidak boleh membuka sheet.
      repo.current = demoRide(RideStatus.driverAssigned);
      await controllerOf(tester).acceptSelectedOffer();
      await tester.pump();
      await poll(tester);

      expect(selectedRef(tester), isNull);
      expect(find.byType(OfferDetailSheet), findsNothing);
    });

    // --- Antrian tanpa sisa (+7) -------------------------------------------
    final t0 = DateTime.utc(2026, 10, 4, 10, 0);
    DriverRide offerAt(String reference, int minutes) =>
        offerRide(reference, updatedAt: t0.add(Duration(minutes: minutes)));

    testWidgets(
        'dua tawaran masuk bersama: yang terbaru terbuka, closeOffer langsung membuka yang lain',
        (tester) async {
      // Celah +6: hanya yang terbaru dibuka; yang lain tidak dicatat tertunda,
      // dan polling berikutnya menganggapnya sudah ada di daftar.
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerAt('RID-OLD', 0), offerAt('RID-NEW', 5)];
      await poll(tester);
      expect(selectedRef(tester), 'RID-NEW');

      final callsBefore = repo.offersCalls;
      controllerOf(tester).closeOffer();
      await tester.pump();

      expect(selectedRef(tester), 'RID-OLD');
      expect(find.byType(OfferDetailSheet), findsOneWidget);
      expect(repo.offersCalls, callsBefore, reason: 'tanpa refresh tambahan');
      controllerOf(tester).closeOffer();
      await tester.pump();
      expect(selectedRef(tester), isNull);
    });

    testWidgets(
        'tiga tawaran masuk bersama: tiga sheet berurutan dari yang terbaru, masing-masing langsung setelah yang sebelumnya ditutup',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      // Urutan daftar sengaja bukan urutan waktu.
      repo.offerItems = [
        offerAt('RID-MID', 5),
        offerAt('RID-OLD', 0),
        offerAt('RID-NEW', 10),
      ];
      await poll(tester);
      final opened = <String?>[selectedRef(tester)];
      final callsBefore = repo.offersCalls;
      for (var i = 0; i < 3; i++) {
        controllerOf(tester).closeOffer();
        await tester.pump();
        opened.add(selectedRef(tester));
      }

      expect(opened, ['RID-NEW', 'RID-MID', 'RID-OLD', null]);
      expect(repo.offersCalls, callsBefore, reason: 'tanpa refresh tambahan');
      // Polling berikutnya tidak membuka ulang satu pun.
      await poll(tester);
      expect(selectedRef(tester), isNull);
    });

    testWidgets('tawaran yang sudah hilang dari daftar tidak dibuka',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerAt('RID-A', 0), offerAt('RID-B', 5), offerAt('RID-C', 10)];
      await poll(tester);
      expect(selectedRef(tester), 'RID-C');
      // B kedaluwarsa/diambil driver lain sebelum C ditutup.
      repo.offerItems = [offerAt('RID-A', 0), offerAt('RID-C', 10)];
      await poll(tester);
      expect(selectedRef(tester), 'RID-C');

      controllerOf(tester).closeOffer();
      await tester.pump();
      expect(selectedRef(tester), 'RID-A');
      controllerOf(tester).closeOffer();
      await tester.pump();
      expect(selectedRef(tester), isNull);
    });

    testWidgets(
        'perjalanan aktif tidak membuka sheet; setelah selesai, beberapa tawaran diantrikan seperti biasa',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
        offerItems: [offerAt('RID-OLD', 0), offerAt('RID-NEW', 5)],
      );
      await pumpDriver(tester, repo);
      await poll(tester);
      expect(selectedRef(tester), isNull);
      expect(find.byType(OfferDetailSheet), findsNothing);

      // Perjalanan selesai: refresh mengembalikan kedua tawaran sekaligus.
      repo.current = null;
      await poll(tester);
      expect(selectedRef(tester), 'RID-NEW');
      controllerOf(tester).closeOffer();
      await tester.pump();
      expect(selectedRef(tester), 'RID-OLD');
    });

    testWidgets(
        'tawaran yang sedang terbuka lalu hilang dari daftar langsung diganti tawaran tertunda tanpa ketukan',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerAt('RID-A', 0)];
      await poll(tester);
      repo.offerItems = [offerAt('RID-A', 0), offerAt('RID-B', 5)];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');

      // A hilang (diambil driver lain) saat sheetnya terbuka; B masih ada.
      repo.offerItems = [offerAt('RID-B', 5)];
      await poll(tester);
      expect(selectedRef(tester), 'RID-B');

      // A sudah "dilihat": tidak kembali walau muncul lagi di daftar.
      controllerOf(tester).closeOffer();
      await tester.pump();
      repo.offerItems = [offerAt('RID-A', 0), offerAt('RID-B', 5)];
      await poll(tester);
      expect(selectedRef(tester), isNull);
    });

    testWidgets('tawaran terbuka yang statusnya bukan searchingDriver diganti tertunda',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerAt('RID-A', 0)];
      await poll(tester);
      repo.offerItems = [offerAt('RID-A', 0), offerAt('RID-B', 5)];
      await poll(tester);
      expect(selectedRef(tester), 'RID-A');

      repo.offerItems = [
        const DriverRide(
          reference: 'RID-A',
          serviceType: 'MOTORCYCLE',
          status: RideStatus.driverAssigned,
          pickupAddress: 'x',
          dropoffAddress: 'y',
        ),
        offerAt('RID-B', 5),
      ];
      await poll(tester);

      expect(selectedRef(tester), 'RID-B');
    });

    testWidgets('selectOffer yang mengganti tawaran lain: yang lama dianggap sudah dilihat',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      repo.offerItems = [offerAt('RID-A', 0)];
      await poll(tester);
      repo.offerItems = [offerAt('RID-A', 0), offerAt('RID-B', 5)];
      await poll(tester);

      controllerOf(tester).selectOffer(offerAt('RID-B', 5));
      expect(selectedRef(tester), 'RID-B');
      controllerOf(tester).closeOffer();
      await tester.pump();

      expect(selectedRef(tester), isNull, reason: 'A sudah dilihat; B tidak tertunda lagi');
    });

    testWidgets('push ride_offer berjudul dan berisi kosong diberi teks bawaan',
        (tester) async {
      // showForegroundAlert kembali diam-diam bila judul dan isi kosong.
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();

      platform.foreground.add(const DriverPushMessage(
          title: '', body: '', data: {'type': 'ride_offer'}));
      platform.foreground.add(const DriverPushMessage(
          title: '', body: '', data: {'type': 'ride_cancelled'}));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(platform.foregroundAlerts, hasLength(2));
      expect(platform.foregroundAlerts[0].title, 'Order baru');
      expect(platform.foregroundAlerts[0].body, 'Ada penumpang di dekat Anda');
      // Jenis lain tidak diubah.
      expect(platform.foregroundAlerts[1].title, isEmpty);
    });
  });

  group('Hitung mundur dan komisi pada tawaran', () {
    DriverRide offer({DateTime? expiresAt, int? fee, int? percent, DateTime? createdAt, String? kind, String payment = 'CASH'}) => DriverRide(
          reference: 'RIDE-CD-001',
          serviceType: 'MOTORCYCLE',
          status: RideStatus.searchingDriver,
          pickupAddress: 'JEMPUT_CD',
          dropoffAddress: 'TUJUAN_CD',
          distanceMeters: 2500,
          durationSeconds: 600,
          totalFare: 9000,
          updatedAt: createdAt,
          searchExpiresAt: expiresAt,
          commissionFee: fee,
          commissionPercent: percent,
          commissionKind: kind,
          paymentMethod: payment,
        );

    // Sheet terbuka otomatis lewat polling; pumpAndSettle TIDAK boleh dipakai setelahnya karena hitung mundur
    // menjadwalkan frame tiap detik.
    Future<FakeDriverRepository> open(WidgetTester tester, DriverRide ride) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [ride],
      );
      await pumpDriverOrders(tester, repo);
      // Tawaran masuk membuka lembar sendiri (tanpa ketukan); beri waktu animasinya selesai.
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byKey(const ValueKey('accept-offer-button')), findsOneWidget);
      return repo;
    }

    Text label(WidgetTester tester) => tester.widget<Text>(find.byKey(const ValueKey('offer-countdown-label')));
    bool acceptEnabled(WidgetTester tester) =>
        tester.widget<FilledButton>(find.byKey(const ValueKey('accept-offer-button'))).onPressed != null;
    String? selectedRef(WidgetTester tester) => ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
        .read(driverControllerProvider)
        .selectedOffer
        ?.reference;

    testWidgets('batas pencarian dari server tampil sebagai hitung mundur yang berjalan', (tester) async {
      await open(
        tester,
        offer(expiresAt: DateTime.now().add(const Duration(seconds: 90)), createdAt: DateTime.now().subtract(const Duration(seconds: 90))),
      );
      expect(find.byKey(const ValueKey('offer-countdown')), findsOneWidget);
      expect(label(tester).data, startsWith('Tawaran berakhir dalam 1:'));
      expect(acceptEnabled(tester), isTrue);
      await tester.pump(const Duration(seconds: 61));
      expect(label(tester).data, startsWith('Tawaran berakhir dalam 0:'));
    });

    testWidgets('waktu habis: tombol terima mati, tulisan berubah, lalu lembar menutup sendiri', (tester) async {
      await open(tester, offer(expiresAt: DateTime.now().add(const Duration(seconds: 2))));
      expect(acceptEnabled(tester), isTrue);
      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(milliseconds: 50));
      expect(label(tester).data, 'Tawaran berakhir');
      expect(acceptEnabled(tester), isFalse);
      expect(find.text('Tawaran berakhir'), findsWidgets);
      expect(selectedRef(tester), 'RIDE-CD-001'); // masih terbuka sebentar
      await tester.pump(const Duration(milliseconds: 1900));
      expect(selectedRef(tester), isNull);
    });

    testWidgets('tawaran yang sudah lewat batas saat dibuka langsung berakhir dan menutup', (tester) async {
      await open(tester, offer(expiresAt: DateTime.now().subtract(const Duration(seconds: 5))));
      expect(label(tester).data, 'Tawaran berakhir');
      expect(acceptEnabled(tester), isFalse);
      await tester.pump(const Duration(milliseconds: 1900));
      expect(selectedRef(tester), isNull);
    });

    testWidgets('komisi menyala: tarif, komisi 8%, dan pendapatan bersih tampil', (tester) async {
      await open(tester, offer(expiresAt: DateTime.now().add(const Duration(minutes: 3)), fee: 720, percent: 8));
      expect(find.byKey(const ValueKey('offer-earnings')), findsOneWidget);
      expect(find.text('Komisi TapGo 8%'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const ValueKey('offer-commission-fee'))).data, '-Rp720');
      expect(tester.widget<Text>(find.byKey(const ValueKey('offer-net-earnings'))).data, 'Rp8.280');
      expect(tester.widget<Text>(find.byKey(const ValueKey('offer-earnings-note'))).data, contains('ditahan'));
    });

    testWidgets('tawaran digital: komisi dipotong dari tarif yang sudah dibayar penumpang, bukan ditahan dari saldo', (tester) async {
      await open(
        tester,
        offer(expiresAt: DateTime.now().add(const Duration(minutes: 3)), fee: 720, percent: 8, kind: 'DEDUCTED', payment: 'DIGITAL'),
      );
      expect(find.text('Tarif (sudah dibayar penumpang, TapGoPay)'), findsOneWidget);
      expect(find.text('Komisi TapGo 8% (dari tarif)'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const ValueKey('offer-net-earnings'))).data, 'Rp8.280');
      final note = tester.widget<Text>(find.byKey(const ValueKey('offer-earnings-note'))).data!;
      expect(note, contains('TapGoPay'));
      expect(note, isNot(contains('ditahan')));
      // Tawaran digital ditandai: driver tidak menagih tunai.
      expect(find.text('TapGoPay'), findsWidgets);
    });

    testWidgets('server lama (tanpa batas dan komisi): tidak ada hitung mundur maupun rincian komisi, tombol tetap aktif',
        (tester) async {
      await open(tester, offer());
      expect(find.byKey(const ValueKey('offer-countdown')), findsNothing);
      expect(find.byKey(const ValueKey('offer-earnings')), findsNothing);
      expect(acceptEnabled(tester), isTrue);
      // Tanpa timer: aman memakai pumpAndSettle.
      await tester.pumpAndSettle();
    });
  });

  group('Password tapgolion.id untuk akun Google', () {
    Widget webPasswordApp(FakeDriverRepository repo, Future<({String idToken, String email})?> Function() token) =>
        ProviderScope(
          overrides: [
            driverRepositoryProvider.overrideWithValue(repo),
            driverGoogleIdTokenProvider.overrideWithValue(token),
            locationPortProvider.overrideWithValue(NoDriverLocationPort()),
            pushPlatformProvider.overrideWithValue(null),
          ],
          child: const MaterialApp(home: DriverWebPasswordScreen()),
        );

    Future<FakeDriverRepository> pumpScreen(
      WidgetTester tester,
      Future<({String idToken, String email})?> Function() token, {
      DriverApiException? error,
    }) async {
      final repo = FakeDriverRepository(session: demoSession)..webPasswordError = error;
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(webPasswordApp(repo, token));
      await tester.pumpAndSettle();
      return repo;
    }

    Future<({String idToken, String email})?> goodToken() async => (idToken: 'ID_TOKEN_BARU', email: 'sopir@gmail.com');

    bool saveEnabled(WidgetTester tester) =>
        tester.widget<FilledButton>(find.byKey(const ValueKey('web-password-save'))).onPressed != null;

    testWidgets('sebelum verifikasi Google: isian dan tombol simpan mati', (tester) async {
      await pumpScreen(tester, goodToken);
      expect(find.byKey(const ValueKey('web-password-verify-button')), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const ValueKey('web-password-new'))).enabled, isFalse);
      expect(saveEnabled(tester), isFalse);
    });

    testWidgets('verifikasi lalu simpan: ID token baru dan password dikirim sekali, layar sukses tampil', (tester) async {
      final repo = await pumpScreen(tester, goodToken);
      await tester.tap(find.byKey(const ValueKey('web-password-verify-button')));
      await tester.pumpAndSettle();
      expect(find.text('Terverifikasi: sopir@gmail.com'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('web-password-new')), 'pendek');
      await tester.enterText(find.byKey(const ValueKey('web-password-confirm')), 'pendek');
      await tester.tap(find.byKey(const ValueKey('web-password-save')));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const ValueKey('web-password-error'))).data, contains('minimal 8'));
      expect(repo.webPasswordCalls, 0);

      await tester.enterText(find.byKey(const ValueKey('web-password-new')), 'KataSandi-Panjang');
      await tester.enterText(find.byKey(const ValueKey('web-password-confirm')), 'KataSandi-Beda');
      await tester.tap(find.byKey(const ValueKey('web-password-save')));
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(find.byKey(const ValueKey('web-password-error'))).data, contains('belum sama'));
      expect(repo.webPasswordCalls, 0);

      await tester.enterText(find.byKey(const ValueKey('web-password-confirm')), 'KataSandi-Panjang');
      await tester.tap(find.byKey(const ValueKey('web-password-save')));
      await tester.pumpAndSettle();
      expect(repo.webPasswordCalls, 1);
      expect(repo.lastWebPasswordIdToken, 'ID_TOKEN_BARU');
      expect(repo.lastWebPassword, 'KataSandi-Panjang');
      expect(find.byKey(const ValueKey('web-password-done')), findsOneWidget);
      expect(find.byKey(const ValueKey('web-password-open-topup')), findsOneWidget);
    });

    testWidgets('server menolak akun Google lain: pesan tampil dan verifikasi diulang dari awal', (tester) async {
      final repo = await pumpScreen(
        tester,
        goodToken,
        error: const DriverApiException(
          code: 'GOOGLE_ACCOUNT_MISMATCH',
          message: 'Akun Google ini bukan akun TapGo Anda.',
          statusCode: 403,
        ),
      );
      await tester.tap(find.byKey(const ValueKey('web-password-verify-button')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('web-password-new')), 'KataSandi-Panjang');
      await tester.enterText(find.byKey(const ValueKey('web-password-confirm')), 'KataSandi-Panjang');
      await tester.tap(find.byKey(const ValueKey('web-password-save')));
      await tester.pumpAndSettle();
      expect(repo.webPasswordCalls, 1);
      expect(find.text('Akun Google ini bukan akun TapGo Anda.'), findsOneWidget);
      expect(find.byKey(const ValueKey('web-password-done')), findsNothing);
      // Token lama tidak dipakai lagi: tombol verifikasi muncul kembali dan simpan mati.
      expect(find.byKey(const ValueKey('web-password-verify-button')), findsOneWidget);
      expect(saveEnabled(tester), isFalse);
    });

    testWidgets('membatalkan pilihan akun Google: tidak ada galat dan tidak ada yang terkirim', (tester) async {
      final repo = await pumpScreen(tester, () async => null);
      await tester.tap(find.byKey(const ValueKey('web-password-verify-button')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('web-password-verified')), findsNothing);
      expect(find.byKey(const ValueKey('web-password-error')), findsNothing);
      expect(repo.webPasswordCalls, 0);
    });

    testWidgets('Google gagal: pesan ramah tampil, bukan layar kosong', (tester) async {
      await pumpScreen(tester, () async => throw const DriverApiException(code: 'GOOGLE_TOKEN_MISSING', message: 'Google tidak mengembalikan token yang valid.'));
      await tester.tap(find.byKey(const ValueKey('web-password-verify-button')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('web-password-error')), findsOneWidget);
    });

    testWidgets('titik masuk: tab Akun memuat baris Password tapgolion.id', (tester) async {
      final repo = FakeDriverRepository(session: demoSession, availability: DriverAvailability.online);
      await pumpDriver(tester, repo);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Akun')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('open-web-password')), findsOneWidget);
    });
  });

  group('Pernyataan kemitraan', () {
    test('naskah memuat semua topik yang diminta Owner dan versinya terisi', () {
      expect(RegExp(r'^\d{4}-\d{2}-\d{2}(\.\d+)?$').hasMatch(kDriverTermsVersion), isTrue);
      final titles = kDriverTermsSections.map((s) => s.title.toLowerCase()).join(' | ');
      for (final topic in [
        'hak anda',
        'kewajiban anda',
        'hak dan kewajiban tapgo',
        'risiko perjalanan',
        'penyelewengan',
        'sanksi',
        'komisi',
        'data pribadi',
        'pengakhiran',
        'sengketa',
      ]) {
        expect(titles, contains(topic), reason: 'bagian "$topic" harus ada');
      }
      // Nomor bagian berurutan 1..N agar rujukan "lihat bagian 6/8" tetap benar.
      for (var i = 0; i < kDriverTermsSections.length; i++) {
        expect(kDriverTermsSections[i].title, startsWith('${i + 1}. '));
      }
      expect(kDriverTermsSections[5].title.toLowerCase(), contains('penyelewengan'));
      expect(kDriverTermsSections[7].title.toLowerCase(), contains('data pribadi'));
      // Tidak ada butir kosong.
      for (final section in kDriverTermsSections) {
        for (final group in section.groups) {
          expect(group.items, isNotEmpty);
          for (final item in group.items) {
            expect(item.trim().length, greaterThan(20), reason: item);
          }
        }
      }
    });

    test('angka komisi di naskah sama dengan komisi yang berlaku (8%)', () {
      final all = kDriverTermsSections
          .expand((s) => [s.intro ?? '', s.outro ?? '', ...s.groups.expand((g) => g.items)])
          .join('\n');
      expect(all, contains('8% dari tarif'));
      expect(all, contains('112'));
      expect(all, contains('SOS'));
    });

    testWidgets('Akun > Bantuan > Pernyataan Kemitraan membuka naskah lengkap yang bisa digulir',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const ValueKey('support-terms')),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tapReachable(tester, find.byKey(const ValueKey('support-terms')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('driver-terms')), findsOneWidget);
      expect(find.text('Versi $kDriverTermsVersion'), findsOneWidget);
      // Bagian pertama terlihat; bagian terakhir dicapai dengan menggulir.
      expect(find.text('1. Status kemitraan'), findsOneWidget);
      await tester.dragUntilVisible(
        find.byKey(const ValueKey('driver-terms-section-10')),
        find.byKey(const ValueKey('driver-terms-scroll')),
        const Offset(0, -300),
      );
      expect(find.text('10. Perubahan dan penyelesaian sengketa'), findsOneWidget);
    });
  });

  group('Pusat Bantuan', () {
    Future<void> openHelp(WidgetTester tester, FakeDriverRepository repo) async {
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const ValueKey('support-help-center')),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tapReachable(tester, find.byKey(const ValueKey('support-help-center')));
      await tester.pumpAndSettle();
    }

    Future<void> reveal(WidgetTester tester, Finder target) async {
      await tester.dragUntilVisible(target, find.byKey(const ValueKey('help-scroll')), const Offset(0, -300));
      await tester.pumpAndSettle();
    }

    testWidgets('FAQ memuat aturan komisi dan saldo minimal sesuai server', (tester) async {
      await openHelp(tester, FakeDriverRepository(session: demoSession));
      expect(find.text('Pusat Bantuan'), findsWidgets);
      await tester.tap(find.byKey(const ValueKey('faq-Berapa komisi TapGo dan bagaimana cara kerjanya?')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Komisi 8%'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('faq-Mengapa saya tidak bisa menerima pesanan tunai?')));
      await tester.pumpAndSettle();
      expect(find.textContaining('minimal Rp50.000'), findsOneWidget);
      await reveal(tester, find.text('Belum ada pertanyaan'));
      expect(find.text('Belum ada pertanyaan'), findsOneWidget);
    });

    testWidgets('driver mengirim pertanyaan; balasan tim tampil di tiket', (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..ticketsResult = [
          DriverSupportTicket(
            reference: 'TKT-ABC123',
            subject: 'Saldo belum masuk',
            status: 'RESOLVED',
            messages: const [
              DriverTicketMessage(body: 'Top up saya belum masuk', fromAdmin: false),
              DriverTicketMessage(body: 'Sudah kami cek, saldo sudah masuk.', fromAdmin: true),
            ],
          ),
        ];
      await openHelp(tester, repo);
      await reveal(tester, find.byKey(const ValueKey('ticket-TKT-ABC123')));
      await tester.tap(find.byKey(const ValueKey('ticket-TKT-ABC123')));
      await tester.pumpAndSettle();
      expect(find.text('Sudah kami cek, saldo sudah masuk.'), findsOneWidget);
      expect(find.text('Tim TapGo'), findsOneWidget);

      await tester.dragUntilVisible(
        find.byKey(const ValueKey('help-new-ticket')),
        find.byKey(const ValueKey('help-scroll')),
        const Offset(0, 300),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('help-new-ticket')));
      await tester.pumpAndSettle();
      // Kosong ditolak lokal, tanpa menyentuh server.
      await tester.tap(find.byKey(const ValueKey('ticket-submit')));
      await tester.pumpAndSettle();
      expect(find.text('Judul dan pesan wajib diisi.'), findsOneWidget);
      expect(repo.createdTickets, isEmpty);

      await tester.enterText(find.byKey(const ValueKey('ticket-subject')), 'Tidak ada tawaran');
      await tester.enterText(find.byKey(const ValueKey('ticket-message')), 'Sudah online 1 jam');
      await tester.tap(find.byKey(const ValueKey('ticket-submit')));
      await tester.pumpAndSettle();
      expect(repo.createdTickets, [('OTHER', 'Tidak ada tawaran', 'Sudah online 1 jam')]);
      expect(find.byKey(const ValueKey('ticket-submit')), findsNothing);
    });

    testWidgets('gagal kirim menampilkan pesan dan lembar tetap terbuka', (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..createTicketError = const DriverApiException(code: 'NETWORK_ERROR', message: 'Koneksi belum stabil.');
      await openHelp(tester, repo);
      await reveal(tester, find.byKey(const ValueKey('help-new-ticket')));
      await tester.tap(find.byKey(const ValueKey('help-new-ticket')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('ticket-subject')), 'Halo');
      await tester.enterText(find.byKey(const ValueKey('ticket-message')), 'Tes');
      await tester.tap(find.byKey(const ValueKey('ticket-submit')));
      await tester.pumpAndSettle();
      expect(find.text('Koneksi belum stabil.'), findsOneWidget);
      expect(find.byKey(const ValueKey('ticket-submit')), findsOneWidget);
    });
  });

  group('Tombol SOS darurat', () {
    testWidgets(
        'kirim SOS berhasil: lokasi terlampir, dialog tertutup, SnackBar tampil',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      final location = RecordingLocationPort(available: true)
        ..fix = const DriverLocationFix(
            lat: -6.2001, lng: 106.8167, accuracyMeters: 8);
      await pumpDriver(tester, repo, locationPort: location);

      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();
      expect(find.text('Kirim sinyal darurat?'), findsOneWidget);

      await tapReachable(tester, find.text('Kirim SOS'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(repo.sosCalls, hasLength(1));
      expect(repo.sosCalls.single['lat'], -6.2001);
      expect(repo.sosCalls.single['lng'], 106.8167);
      expect(repo.sosCalls.single['accuracyMeters'], 8);
      expect(find.text('Kirim sinyal darurat?'), findsNothing);
      expect(
        find.text('Sinyal darurat terkirim. Tim TapGo akan segera menghubungi Anda.'),
        findsOneWidget,
      );
    });

    testWidgets(
        'ride aktif otomatis terlampir sebagai rideReference tanpa driver memilih',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      final location = RecordingLocationPort(available: true)
        ..fix = const DriverLocationFix(
            lat: -6.2001, lng: 106.8167, accuracyMeters: 8);
      await pumpDriver(tester, repo, locationPort: location);

      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();
      await tapReachable(tester, find.text('Kirim SOS'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(repo.sosCalls.single['rideReference'], 'RIDE-DEMO-001');
    });

    testWidgets(
        'lokasi tidak tersedia: dialog tetap terbuka dengan pesan, bukan mengirim koordinat kosong',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      final location = RecordingLocationPort(available: true);
      // fix sengaja dibiarkan null (default) meniru GPS gagal mengambil titik.
      await pumpDriver(tester, repo, locationPort: location);

      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();
      await tapReachable(tester, find.text('Kirim SOS'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(repo.sosCalls, isEmpty);
      expect(find.text('Kirim sinyal darurat?'), findsOneWidget);
      // Bisa tampil dua kali (dialog + ErrorNotice tab di belakangnya,
      // sama-sama membaca state.message) — yang penting pesannya ADA.
      expect(
        find.textContaining('Tidak bisa mendapatkan lokasi Anda'),
        findsWidgets,
      );
    });

    testWidgets(
        'SOS gagal karena server belum punya rute: pesan Indonesia, tombol tidak macet, WhatsApp CS tetap ada',
        (tester) async {
      // Backend produksi yang belum memuat rute SOS membalas 404
      // ROUTE_NOT_FOUND (pesan Inggris). Driver dalam bahaya harus tetap
      // melihat jalan keluar: tombol bisa ditekan lagi dan CS tersedia.
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      )..sosError = const DriverApiException(
          code: 'ROUTE_NOT_FOUND',
          message: 'Fitur ini belum tersedia di server. Perbarui aplikasi atau coba lagi nanti.',
          statusCode: 404,
        );
      final location = RecordingLocationPort(available: true)
        ..fix = const DriverLocationFix(lat: -6.2, lng: 106.8, accuracyMeters: 8);
      await pumpDriver(tester, repo, locationPort: location);

      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();
      await tapReachable(tester, find.text('Kirim SOS'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Kirim sinyal darurat?'), findsOneWidget);
      expect(find.textContaining('belum tersedia di server'), findsWidgets);
      expect(find.textContaining('Route '), findsNothing);
      expect(find.text('WhatsApp CS'), findsOneWidget);
      final send = tester.widget<FilledButton>(
          find.ancestor(of: find.text('Kirim SOS'), matching: find.byType(FilledButton)));
      expect(send.onPressed, isNotNull);
    });

    testWidgets('galat tak terduga saat SOS tidak membuat tombol macet',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      )..sosError = StateError('di luar dugaan');
      final location = RecordingLocationPort(available: true)
        ..fix = const DriverLocationFix(lat: -6.2, lng: 106.8, accuracyMeters: 8);
      await pumpDriver(tester, repo, locationPort: location);

      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();
      await tapReachable(tester, find.text('Kirim SOS'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Kirim sinyal darurat?'), findsOneWidget);
      expect(find.textContaining('StateError'), findsNothing);
      expect(find.textContaining('di luar dugaan'), findsNothing);
      final send = tester.widget<FilledButton>(
          find.ancestor(of: find.text('Kirim SOS'), matching: find.byType(FilledButton)));
      expect(send.onPressed, isNotNull);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'dialog SOS: Batal, WhatsApp CS, dan Kirim SOS ditumpuk selebar dialog; tidak ada "SOS Kirim SOS"',
        (tester) async {
      // Uji HP +7: tiga tombol di AlertDialog.actions membuat "Batal" terlempar
      // ke baris sendiri, dan ikon Icons.sos_rounded menggambar huruf SOS di
      // depan teks "Kirim SOS" sehingga terbaca "SOS Kirim SOS".
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      await pumpDriver(tester, repo);
      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();

      // Satu judul dan penjelasan yang sama.
      expect(find.text('Kirim sinyal darurat?'), findsOneWidget);
      expect(find.textContaining('Lokasi Anda saat ini akan dikirim ke tim TapGo'),
          findsOneWidget);
      // Ketiga label ada.
      expect(find.text('Batal'), findsOneWidget);
      expect(find.text('WhatsApp CS'), findsOneWidget);
      expect(find.text('Kirim SOS'), findsOneWidget);
      expect(find.text('SOS Kirim SOS'), findsNothing);
      // Tidak ada ikon huruf SOS di dialog (dan tombol kirim tanpa ikon sama sekali).
      expect(
        find.descendant(of: find.byType(AlertDialog), matching: find.byIcon(Icons.sos_rounded)),
        findsNothing,
      );

      final batal = tester.getRect(find.ancestor(
          of: find.text('Batal'), matching: find.bySubtype<ButtonStyleButton>()));
      final wa = tester.getRect(find.ancestor(
          of: find.text('WhatsApp CS'), matching: find.bySubtype<ButtonStyleButton>()));
      final kirim = tester.getRect(find.ancestor(
          of: find.text('Kirim SOS'), matching: find.bySubtype<ButtonStyleButton>()));
      // Ditumpuk dari atas ke bawah: Batal, lalu WhatsApp CS, lalu Kirim SOS.
      expect(batal.bottom, lessThanOrEqualTo(wa.top));
      expect(wa.bottom, lessThanOrEqualTo(kirim.top));
      // Selebar dialog: ketiganya sama lebar dan sama posisi kiri.
      expect(wa.width, closeTo(batal.width, 0.5));
      expect(kirim.width, closeTo(batal.width, 0.5));
      expect(wa.left, closeTo(batal.left, 0.5));
      expect(kirim.left, closeTo(batal.left, 0.5));
      final dialog = tester.getRect(find.byType(AlertDialog));
      expect(batal.width, greaterThan(dialog.width * 0.6));
    });

    testWidgets('tombol WhatsApp CS selalu tersedia di dialog SOS sebagai cadangan',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      await pumpDriver(tester, repo);

      await tapReachable(tester, find.byTooltip('SOS Darurat'));
      await tester.pumpAndSettle();
      expect(find.text('WhatsApp CS'), findsOneWidget);
    });
  });

  group('Keselamatan selama online: kelelahan dan verifikasi ulang wajah', () {
    testWidgets(
        'banner kelelahan tampil saat restRequired true, hilang lagi saat pulih',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      await pumpDriver(tester, repo);
      expect(find.byKey(const ValueKey('fatigue-banner')), findsNothing);

      repo.fatigueStatus = const DriverFatigueStatus(
        continuousOnlineMinutes: 665,
        thresholdMinutes: 660,
        restRequired: true,
      );
      // Poll pertama (saat _startPolling dipanggil dari restore()) sudah
      // lewat sebelum repo.fatigueStatus diubah di atas — detak PERIODIK
      // berikutnya (3 menit) yang membawa nilai baru ini ke state.
      await tester.pump(const Duration(minutes: 3));
      await tester.pump();
      expect(find.byKey(const ValueKey('fatigue-banner')), findsOneWidget);
      expect(find.textContaining('11 jam 5 menit'), findsOneWidget);

      repo.fatigueStatus = const DriverFatigueStatus(
        continuousOnlineMinutes: 5,
        thresholdMinutes: 660,
        restRequired: false,
      );
      await tester.pump(const Duration(minutes: 3));
      await tester.pump();
      expect(find.byKey(const ValueKey('fatigue-banner')), findsNothing);
    });

    testWidgets(
        'banner verifikasi ulang tampil saat faceRecheckDue true dan membuka layar recheck saat ditekan',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      await pumpDriver(tester, repo);
      expect(find.byKey(const ValueKey('face-recheck-banner')), findsNothing);

      repo.faceRecheckDue = true;
      await tester.pump(const Duration(minutes: 3));
      await tester.pump();
      expect(find.byKey(const ValueKey('face-recheck-banner')), findsOneWidget);
      expect(
        find.textContaining('Anda tidak akan menerima pesanan baru'),
        findsOneWidget,
      );

      await tapReachable(tester, find.text('Verifikasi Sekarang'));
      // BUKAN pumpAndSettle: DriverFaceCheckScreen memanggil availableCameras()
      // sungguhan yang tidak pernah selesai di lingkungan widget test — sama
      // seperti pola pengujian checkAndGoOnline di atas.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(find.byType(DriverFaceCheckScreen), findsOneWidget);
      expect(find.text('Verifikasi Ulang Wajah'), findsOneWidget);
      final screen = tester.widget<DriverFaceCheckScreen>(find.byType(DriverFaceCheckScreen));
      expect(screen.isRecheck, isTrue);
    });

    testWidgets(
        'faceRecheckDue diutamakan di atas fatigueWarning saat keduanya aktif bersamaan',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
      );
      await pumpDriver(tester, repo);

      repo.faceRecheckDue = true;
      repo.fatigueStatus = const DriverFatigueStatus(
        continuousOnlineMinutes: 700,
        thresholdMinutes: 660,
        restRequired: true,
      );
      await tester.pump(const Duration(minutes: 3));
      await tester.pump();
      expect(find.byKey(const ValueKey('face-recheck-banner')), findsOneWidget);
      expect(find.byKey(const ValueKey('fatigue-banner')), findsNothing);
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
      await pumpDriverOrders(tester, repo);
      expect(find.text('Perjalanan Aktif'), findsOneWidget);
      expect(find.text('RIDE-DEMO-001'), findsOneWidget);
    });

    testWidgets(
        'peta, nama penumpang, dan tombol navigasi tampil saat koordinat tersedia',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRideWithLocation(RideStatus.driverToPickup),
      );
      await pumpDriverOrders(tester, repo);
      expect(find.byKey(const ValueKey('active-ride-map')), findsOneWidget);
      expect(find.byKey(const ValueKey('trip-navigate-action')), findsOneWidget);
      expect(find.byKey(const ValueKey('active-ride-passenger-name')),
          findsOneWidget);
      expect(find.text('Sari'), findsOneWidget);
    });

    testWidgets(
        'peta dan tombol navigasi disembunyikan bila koordinat belum tersedia (order lama)',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverToPickup),
      );
      await pumpDriverOrders(tester, repo);
      expect(find.byKey(const ValueKey('active-ride-map')), findsNothing);
      expect(find.byKey(const ValueKey('trip-navigate-action')), findsNothing);
      expect(find.byKey(const ValueKey('active-ride-passenger-name')),
          findsNothing);
      // Kartu perjalanan tetap tampil apa adanya — fail-soft, bukan crash.
      expect(find.text('Perjalanan Aktif'), findsOneWidget);
    });

    testWidgets('no current ride kembali ke home/offers', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriverOrders(tester, repo);
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
      await pumpDriverOrders(tester, repo);
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
      await pumpDriverOrders(tester, cancelRepo);
      final cancelAction = find.byKey(const ValueKey('trip-cancel-action'));
      await tapReachable(tester, cancelAction);
      await tester.pumpAndSettle();
      // Dialog alasan: tombol konfirmasi mati sampai satu alasan dipilih.
      final confirm = find.byKey(const ValueKey('cancel-confirm'));
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
      await tester.tap(find.byKey(const ValueKey('cancel-reason-PASSENGER_UNREACHABLE')));
      await tester.pumpAndSettle();
      await tester.tap(confirm);
      await tester.pumpAndSettle();
      expect(cancelRepo.cancelCalls, 1);
      expect(cancelRepo.lastCancelReason, 'PASSENGER_UNREACHABLE');
    });

    testWidgets('tab pendapatan menampilkan saldo TapGo, catatan komisi, dan riwayat',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..walletResult = DriverWalletSummary(
          balance: 84280,
          commissionEnabled: true,
          commissionPercent: 8,
          topUpUrl: 'https://tapgolion.id/topup',
          entries: [
            DriverWalletEntry(
                id: 'e1',
                kind: 'COMMISSION',
                amount: -720,
                createdAt: DateTime(2026, 9, 10, 9, 30),
                rideReference: 'RID-ABC12345',
                shortfall: 300),
            const DriverWalletEntry(id: 'e2', kind: 'TOPUP', amount: 100000),
          ],
        );
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('wallet-card')), findsOneWidget);
      expect(find.text('Rp84.280'), findsOneWidget);
      expect(find.byKey(const ValueKey('wallet-commission-note')), findsOneWidget);
      expect(find.text('-Rp720'), findsOneWidget);
      expect(find.text('+Rp100.000'), findsOneWidget);
      expect(find.textContaining('kurang Rp300'), findsOneWidget);
      expect(find.byKey(const ValueKey('wallet-topup-button')), findsOneWidget);
    });

    testWidgets(
        'setelah isi saldo di peramban: kembali ke aplikasi memuat ulang saldo, tarik layar juga memuat ulang',
        (tester) async {
      DriverWalletSummary wallet(int balance) => DriverWalletSummary(
            balance: balance,
            commissionEnabled: true,
            commissionPercent: 8,
            topUpUrl: 'https://tapgolion.id/topup',
            entries: const [],
          );
      final repo = FakeDriverRepository(session: demoSession)
        ..walletResult = wallet(1000);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      expect(find.text('Rp1.000'), findsOneWidget);

      // Driver mengisi saldo di peramban; server kini mencatat Rp26.000.
      repo.walletResult = wallet(26000);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Rp26.000'), findsOneWidget);
      expect(find.text('Rp1.000'), findsNothing);

      // Tarik layar ke bawah juga memuat ulang.
      repo.walletResult = wallet(31000);
      final callsBefore = repo.walletCalls;
      await tester.fling(find.byKey(const ValueKey('earnings-refresh')), const Offset(0, 400), 1000);
      await tester.pumpAndSettle();
      expect(repo.walletCalls, greaterThan(callsBefore));
      expect(find.text('Rp31.000'), findsOneWidget);
    });

    DriverWalletSummary walletWith(int balance, {bool commission = true, int min = 50000}) => DriverWalletSummary(
          balance: balance,
          commissionEnabled: commission,
          commissionPercent: 8,
          topUpUrl: 'https://tapgolion.id/topup',
          entries: const [],
          minCashBalance: min,
        );

    test('model saldo: membaca saldo minimal menerima pesanan tunai; server lama tanpa field = tanpa batas', () {
      final parsed = DriverWalletSummary.fromJson({
        'balance': 7000,
        'commissionEnabled': true,
        'commissionPercent': 8,
        'minCashBalance': 50000,
        'topUpUrl': 'https://tapgolion.id/topup',
        'entries': [],
      });
      expect(parsed.minCashBalance, 50000);
      final old = DriverWalletSummary.fromJson({'balance': 7000, 'commissionEnabled': true, 'commissionPercent': 8, 'entries': []});
      expect(old.minCashBalance, 0);
    });

    testWidgets('kartu saldo: catatan menyebut saldo minimal Rp50.000 untuk menerima pesanan tunai; tanpa batas memakai kalimat lama',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession)..walletResult = walletWith(25000);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      expect(find.textContaining('saldo minimal Rp50.000'), findsOneWidget);
      expect(find.textContaining('ditahan dari saldo ini saat Anda menerima pesanan'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      final noLimit = FakeDriverRepository(session: demoSession)..walletResult = walletWith(25000, min: 0);
      await pumpDriver(tester, noLimit);
      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      expect(find.textContaining('saldo minimal'), findsNothing);
      expect(find.textContaining('Saldo harus cukup untuk menerima pesanan tunai'), findsOneWidget);
    });

    testWidgets('Beranda: tidak ada banner peringatan saldo (keputusan Owner: batas Rp50.000 sudah cukup jelas)', (tester) async {
      final repo = FakeDriverRepository(session: demoSession)..walletResult = walletWith(5000);
      await pumpDriver(tester, repo);
      expect(find.byKey(const ValueKey('low-balance-banner')), findsNothing);
      expect(find.textContaining('hampir habis'), findsNothing);
    });

    testWidgets('komisi mati: tidak ada catatan komisi, saldo nol tetap tampil',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('wallet-balance')), findsOneWidget);
      expect(find.byKey(const ValueKey('wallet-commission-note')), findsNothing);
    });

    testWidgets('kartu tawaran menampilkan jarak ke titik jemput', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [
          const DriverRide(
            reference: 'RIDE-DEMO-001',
            serviceType: 'MOTORCYCLE',
            status: RideStatus.searchingDriver,
            pickupAddress: 'LOKASI_DEMO_A',
            dropoffAddress: 'LOKASI_DEMO_B',
            distanceMeters: 2500,
            durationSeconds: 600,
            totalFare: 9000,
            distanceToPickupMeters: 1800,
          ),
        ],
      );
      await pumpDriverOrders(tester, repo);
      // Tawaran yang sudah ada saat muat pertama kini membuka OfferDetailSheet
      // otomatis (1.0.0+5); jarak tampil di sheet DAN di kartu. Tes ini
      // memeriksa kartu di daftar, jadi sheetnya ditutup dulu.
      expect(find.byType(OfferDetailSheet), findsOneWidget);
      ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
          .read(driverControllerProvider.notifier)
          .closeOffer();
      await tester.pump();
      expect(find.byKey(const ValueKey('offer-distance-to-pickup')), findsOneWidget);
      expect(find.textContaining('dari Anda'), findsOneWidget);
    });

    testWidgets('unknown/terminal status menghentikan action primer',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.unknown),
      );
      await pumpDriverOrders(tester, repo);
      expect(find.byKey(const ValueKey('trip-primary-action')), findsNothing);

      final doneRepo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.completed),
      );
      await pumpDriverOrders(tester, doneRepo);
      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.byKey(const ValueKey('trip-primary-action')), findsNothing);
    });

    testWidgets('perjalanan selesai: driver bisa menilai penumpang (bintang + catatan) sekali', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.completed),
      );
      await pumpDriverOrders(tester, repo);
      final submit = find.byKey(const ValueKey('rate-passenger-submit'));
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      // Belum memilih bintang: tombol kirim mati.
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);

      await tester.ensureVisible(find.byKey(const ValueKey('rate-passenger-star-4')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('rate-passenger-star-4')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('rate-passenger-note')), 'Sopan');
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      await tester.tap(submit);
      await tester.pumpAndSettle();

      expect(repo.ratedPassengers, hasLength(1));
      expect(repo.ratedPassengers.single.$2, 4);
      expect(repo.ratedPassengers.single.$3, 'Sopan');
      expect(find.byKey(const ValueKey('rate-passenger-done')), findsOneWidget);
      expect(find.byKey(const ValueKey('rate-passenger-submit')), findsNothing);
    });

    testWidgets('penilaian penumpang boleh dilewati dan kegagalan menampilkan pesan', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.completed),
      )..ratePassengerError =
          const DriverApiException(code: 'NETWORK_ERROR', message: 'Koneksi belum stabil.');
      await pumpDriverOrders(tester, repo);
      await tester.ensureVisible(find.byKey(const ValueKey('rate-passenger-star-5')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('rate-passenger-star-5')));
      await tester.pumpAndSettle();
      final submit = find.byKey(const ValueKey('rate-passenger-submit'));
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.text('Koneksi belum stabil.'), findsOneWidget);
      expect(repo.ratedPassengers, isEmpty);

      final skip = find.byKey(const ValueKey('rate-passenger-skip'));
      await tester.ensureVisible(skip);
      await tester.pumpAndSettle();
      await tester.tap(skip);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('rate-passenger-submit')), findsNothing);
    });

    testWidgets('lifecycle resume melakukan tepat satu refresh current ride',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverToPickup),
      );
      await pumpDriverOrders(tester, repo);
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

  group('R2.5B ride history', () {
    testWidgets('daftar riwayat tampil dari tab Pesanan > Riwayat, terbaru dulu',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        historyItems: const [
          DriverRide(
            reference: 'RIDE-DEMO-002',
            serviceType: 'MOTORCYCLE',
            status: RideStatus.completed,
            pickupAddress: 'LOKASI_DEMO_A',
            dropoffAddress: 'LOKASI_DEMO_B',
            totalFare: 9000,
          ),
          DriverRide(
            reference: 'RIDE-DEMO-001',
            serviceType: 'MOTORCYCLE',
            status: RideStatus.cancelledByDriver,
            pickupAddress: 'LOKASI_DEMO_A',
            dropoffAddress: 'LOKASI_DEMO_B',
            totalFare: 9000,
          ),
        ],
      );
      await pumpDriverOrders(tester, repo);

      await tester.tap(find.text('Riwayat'));
      await tester.pumpAndSettle();

      expect(repo.historyCalls, 1);
      expect(find.byKey(const ValueKey('ride-history-list')), findsOneWidget);
      expect(find.text('RIDE-DEMO-002'), findsOneWidget);
      expect(find.text('RIDE-DEMO-001'), findsOneWidget);
    });

    testWidgets('daftar kosong menampilkan pesan, bukan error',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriverOrders(tester, repo);

      await tester.tap(find.text('Riwayat'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('ride-history-empty')), findsOneWidget);
    });

    testWidgets('kegagalan jaringan menampilkan retry, bukan crash',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      repo.historyError = const DriverApiException(
        code: 'NETWORK_ERROR',
        message: 'Koneksi belum stabil.',
      );
      await pumpDriverOrders(tester, repo);

      await tester.tap(find.text('Riwayat'));
      await tester.pumpAndSettle();

      expect(find.text('Koneksi belum stabil.'), findsOneWidget);
      expect(find.byKey(const ValueKey('ride-history-retry')), findsOneWidget);
    });
  });

  group('navigasi 4 tab dan peta live Beranda', () {
    testWidgets('NavigationBar menampilkan 4 destinasi: Beranda, Pesanan, Pendapatan, Akun',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);

      final nav = tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(nav.destinations, hasLength(4));
      final labels = nav.destinations
          .cast<NavigationDestination>()
          .map((d) => d.label)
          .toList();
      expect(labels, ['Beranda', 'Pesanan', 'Pendapatan', 'Akun']);
    });

    testWidgets('peta Beranda merender FlutterMap tanpa fix lokasi (mode demo/tanpa GPS)',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);

      expect(find.byKey(const ValueKey('driver-home-map')), findsOneWidget);
      // Tanpa fix (NoDriverLocationPort default di test), marker tidak boleh
      // tampil — hanya tile dasar, bukan posisi palsu.
      expect(find.byIcon(Icons.two_wheeler_rounded), findsNothing);
    });

    testWidgets('peta Beranda menampilkan marker begitu positionStream mengirim fix GPS',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      // StreamController, bukan Stream.value: langganan StreamBuilder harus
      // sudah terpasang SEBELUM fix dikirim, supaya tidak bergantung pada
      // urutan microtask antara subscribe dan emit satu nilai tunggal.
      final controller = StreamController<(double, double)>.broadcast();
      addTearDown(controller.close);
      final location = RecordingLocationPort(available: true, fixes: controller.stream);
      // MarkerLayer memangkas marker di luar viewport kamera saat ini
      // (lihat flutter_map MarkerLayer.build — "Cull if out of bounds").
      // Kamera peta dipusatkan ke _defaultCenter pada frame PERTAMA dan
      // tidak otomatis mengikuti fix baru (masalah UX terpisah, di luar
      // cakupan perbaikan ini) — jadi fix di sini sengaja praktis identik
      // dengan _defaultCenter, supaya test ini murni menguji penyaluran fix
      // ke MarkerLayer, bukan perilaku kamera flutter_map itu sendiri.
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
        buildTestableDriverApp(repository: repo, locationPort: location),
      );
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      controller.add((-6.1754, 106.8272));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('driver-home-map')), findsOneWidget);
      expect(find.byIcon(Icons.two_wheeler_rounded), findsOneWidget);
    });

    testWidgets(
        'kembali ke tab Beranda dari tab lain menyegarkan activeRide (regresi kartu basi)',
        (tester) async {
      // Regresi Owner 29 Sep 2026: ride sudah COMPLETED di server (tab
      // Pesanan > Riwayat sudah benar), tapi kartu "Perjalanan aktif" di
      // Beranda tetap menampilkan status lama ("Dalam Perjalanan") karena
      // activeRide hanya disegarkan lewat polling 12 detik atau saat app
      // resume dari background — TIDAK ada apa pun yang menyegarkannya saat
      // driver sekadar berpindah tab. Perbaikan: DriverHomeScreen memanggil
      // refreshWorkspace() di initState-nya sendiri, jadi AnimatedSwitcher
      // yang membangunnya ulang setiap kali tab Beranda dipilih otomatis
      // memicu penyegaran — dibuktikan di sini lewat hitungan currentRideCalls,
      // BUKAN dengan menunggu timer poll.
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      await pumpDriver(tester, repo);
      expect(find.text('Dalam Perjalanan'), findsWidgets);

      // Pindah ke tab lain lalu kembali ke Beranda — di dunia nyata, ride
      // sudah berubah jadi COMPLETED di server pada titik ini.
      await tester.tap(find.byIcon(Icons.receipt_long_rounded));
      await tester.pumpAndSettle();
      repo.current = demoRide(RideStatus.completed);
      final beforeReturn = repo.currentRideCalls;

      await tester.tap(find.byIcon(Icons.home_rounded));
      await tester.pumpAndSettle();

      expect(repo.currentRideCalls, greaterThan(beforeReturn));
      expect(find.text('Selesai'), findsWidgets);
      expect(find.text('Dalam Perjalanan'), findsNothing);
    });
  });

  group('R2.5B earnings and performance', () {
    testWidgets('ringkasan pendapatan dan performa tampil dari tab Pendapatan',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        earningsSummaryResult: const DriverEarningsSummary(
          range: 'today',
          tripCount: 3,
          grossFare: 27000,
          currency: 'IDR',
          byDay: [
            DriverEarningsDay(date: '2026-09-10', tripCount: 3, grossFare: 27000),
          ],
        ),
        performanceSummaryResult: const DriverPerformanceSummary(
          totalTrips: 10,
          acceptanceRate: 0.8,
          completionRate: 0.9,
          cancellationRate: 0.1,
        ),
      );
      await pumpDriver(tester, repo);

      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('earnings-summary-card')), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('Rp27.000'), findsWidgets);
      // Kartu performa ada di bawah kartu saldo (yang kini memuat tautan atur password web): gulir dulu.
      await tester.scrollUntilVisible(find.byKey(const ValueKey('performance-card')), 300);
      expect(find.byKey(const ValueKey('performance-card')), findsOneWidget);
      expect(find.text('80%'), findsOneWidget);
      expect(find.text('90%'), findsOneWidget);
      expect(find.text('10%'), findsOneWidget);
    });

    testWidgets('penilaian penumpang tampil di kartu performa dan membuka layar ulasan',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        performanceSummaryResult: const DriverPerformanceSummary(
          totalTrips: 10,
          ratingAverage: 4.75,
          ratingCount: 4,
        ),
      )..ratingsSummaryResult = const DriverRatingsSummary(
          ratingAverage: 4.75,
          ratingCount: 4,
          distribution: {1: 0, 2: 0, 3: 0, 4: 1, 5: 3},
          recent: [DriverReview(stars: 4, note: 'Tepat waktu')],
        );
      await pumpDriver(tester, repo);

      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const ValueKey('performance-rating-row')), 300);
      expect(find.text('4,8 (4)'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const ValueKey('performance-rating-row')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('performance-rating-row')));
      await tester.pumpAndSettle();
      expect(find.text('Penilaian penumpang'), findsWidgets);
      expect(find.byKey(const ValueKey('ratings-summary-card')), findsOneWidget);
      expect(find.text('Tepat waktu'), findsOneWidget);
      expect(repo.ratingsCalls, 1);
    });

    testWidgets('belum ada penilaian: layar ulasan menjelaskan, bukan 0,0', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);

      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const ValueKey('performance-rating-row')), 300);
      expect(find.text('Belum ada'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const ValueKey('performance-rating-row')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('performance-rating-row')));
      await tester.pumpAndSettle();
      expect(find.text('Belum ada penilaian'), findsOneWidget);
    });

    testWidgets('rentang berbeda memanggil ulang ringkasan pendapatan',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);

      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();
      expect(repo.earningsCalls, 1);

      await tester.tap(find.byKey(const ValueKey('earnings-range-week')));
      await tester.pumpAndSettle();
      expect(repo.earningsCalls, 2);
    });

    testWidgets('belum ada data performa menampilkan "Belum ada data", bukan 0%',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);

      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();

      expect(find.text('Belum ada data'), findsNWidgets(3));
    });

    testWidgets('kegagalan jaringan pada pendapatan menampilkan retry',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      repo.earningsError = const DriverApiException(
        code: 'NETWORK_ERROR',
        message: 'Koneksi belum stabil.',
      );
      await pumpDriver(tester, repo);

      await tester.tap(find.byIcon(Icons.savings_rounded));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('earnings-retry')), findsOneWidget);
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
      await tester.tap(find.byIcon(Icons.receipt_long_rounded));
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

    testWidgets('lokasi terkirim berkala selama workspace aktif',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      expect(location.sendCalls, 0);

      // Detak 1 detik, kirim tiap 15 detak saat idle — pump waktu palsu, bukan menunggu nyata.
      await tester.pump(const Duration(seconds: 14));
      expect(location.sendCalls, 1);

      await tester.pump(const Duration(seconds: 15));
      expect(location.sendCalls, 2);
    });

    testWidgets(
        'gangguan jaringan sesaat saat polling tidak menutup workspace dan polling terus berjalan',
        (tester) async {
      // Sebelumnya satu kegagalan jaringan pada poll 12 detik memanggil
      // _applyCapabilityError: seluruh workspace diganti layar "Koneksi belum
      // stabil" DAN _stopPolling() mematikan polling + pengiriman lokasi —
      // driver di tengah perjalanan (mis. lewat terowongan) kehilangan
      // aplikasinya sampai menekan "Coba lagi" secara manual.
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('network-error')), findsNothing);

      repo.currentError = const DriverApiException(
        code: 'NETWORK_ERROR',
        message: 'Koneksi belum stabil. Silakan coba lagi.',
      );
      final callsBefore = repo.currentRideCalls;
      await tester.pump(const Duration(seconds: 12));
      await tester.pump();
      expect(repo.currentRideCalls, greaterThan(callsBefore),
          reason: 'poll harus benar-benar mencoba lagi');
      expect(find.byKey(const ValueKey('network-error')), findsNothing);
      expect(find.byType(NavigationBar), findsOneWidget);

      // Jaringan pulih: polling masih hidup tanpa campur tangan driver.
      repo.currentError = null;
      final callsAfterFailure = repo.currentRideCalls;
      await tester.pump(const Duration(seconds: 12));
      await tester.pump();
      expect(repo.currentRideCalls, greaterThan(callsAfterFailure));
      expect(find.byKey(const ValueKey('network-error')), findsNothing);

      // Lokasi tetap terkirim sepanjang gangguan.
      final sendsBefore = location.sendCalls;
      await tester.pump(const Duration(seconds: 5));
      expect(location.sendCalls, greaterThan(sendsBefore));
    });

    testWidgets(
        'status akun benar-benar berubah (suspended) saat polling tetap menutup workspace',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      await tester.pumpWidget(buildTestableDriverApp(repository: repo));
      await tester.pumpAndSettle();
      repo.currentError = const DriverApiException(
        code: 'RIDE_DRIVER_SUSPENDED',
        message: 'Akun driver ditangguhkan.',
        statusCode: 403,
      );
      await tester.pump(const Duration(seconds: 12));
      await tester.pump();
      expect(find.byType(NavigationBar), findsNothing);
    });

    testWidgets('sedang mengantar (inTrip): lokasi terkirim tiap 2 detik, GPS mode hemat',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      final before = location.sendCalls;

      await tester.pump(const Duration(seconds: 6));
      expect(location.sendCalls - before, 3);
      expect(location.fastTrackingRequests, isEmpty,
          reason: 'mengantar tidak memerlukan GPS tiap detik');
    });

    for (final status in [
      RideStatus.driverAssigned,
      RideStatus.driverToPickup,
      RideStatus.driverArrived,
    ]) {
      testWidgets(
          '$status: menuju/menunggu di titik jemput: lokasi terkirim tiap 1 detik dan GPS mode cepat',
          (tester) async {
        final repo = FakeDriverRepository(
          session: demoSession,
          current: demoRide(status),
        );
        final location = RecordingLocationPort(available: true);
        await tester.pumpWidget(
            buildTestableDriverApp(repository: repo, locationPort: location));
        await tester.pumpAndSettle();
        final before = location.sendCalls;

        await tester.pump(const Duration(seconds: 3));
        expect(location.sendCalls - before, 3,
            reason: 'jeda antar kiriman harus 1 detik agar penumpang melihat gerak <= 3 detik');
        expect(location.fastTrackingRequests, [true]);
      });
    }

    testWidgets('jaringan lambat: kiriman lokasi tidak menumpuk (satu pada satu waktu)',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverToPickup),
      );
      final location = RecordingLocationPort(available: true)
        ..sendGate = Completer<void>();
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 8));
      expect(location.sendCalls, 1,
          reason: 'selama kiriman pertama menggantung, detak berikutnya dilewati');
      expect(location.maxSendInFlight, 1);

      location.sendGate!.complete();
      await tester.pump(const Duration(seconds: 2));
      expect(location.sendCalls, greaterThan(1));
      expect(location.maxSendInFlight, 1);
    });

    test('selang kirim lokasi menurut keadaan perjalanan', () {
      expect(DriverController.locationEveryTicksFor(null), 15);
      expect(DriverController.locationEveryTicksFor(demoRide(RideStatus.driverAssigned)), 1);
      expect(DriverController.locationEveryTicksFor(demoRide(RideStatus.driverToPickup)), 1);
      expect(DriverController.locationEveryTicksFor(demoRide(RideStatus.driverArrived)), 1);
      expect(DriverController.locationEveryTicksFor(demoRide(RideStatus.inTrip)), 2);
      expect(DriverController.locationEveryTicksFor(demoRide(RideStatus.completed)), 15);
      expect(DriverController.locationEveryTicksFor(demoRide(RideStatus.cancelledByPassenger)), 15);
    });

    testWidgets('offline: layanan latar depan tidak menyala', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      expect(location.startTrackingCalls, 0);
    });

    testWidgets(
        'perjalanan aktif: layanan latar depan menyala dan tetap jalan saat aplikasi ke latar',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
      );
      final location = RecordingLocationPort(available: true);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, locationPort: location));
      await tester.pumpAndSettle();
      expect(location.startTrackingCalls, greaterThan(0));
      final stopsBefore = location.stopTrackingCalls;

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      final sendsBefore = location.sendCalls;
      await tester.pump(const Duration(seconds: 4));
      expect(location.stopTrackingCalls, stopsBefore);
      expect(location.sendCalls, greaterThan(sendsBefore));
    });

  group('push notifikasi driver', () {
    testWidgets(
        'token didaftarkan setelah workspace aktif dan dicabut saat logout',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok-123');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      expect(repo.registeredPushTokens, ['tok-123']);

      final container = ProviderScope.containerOf(
          tester.element(find.byType(TapGoDriverApp)));
      unawaited(container.read(driverControllerProvider.notifier).logout());
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      expect(repo.unregisteredPushTokens, ['tok-123']);
      expect(platform.deleted, isTrue);
    });

    testWidgets(
        'token dikirim bersama bunyi pilihan; mengganti bunyi mendaftarkan ulang token yang sama',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok-123');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      await tester.pump(const Duration(seconds: 1));
      // Belum pernah memilih: bunyi bawaan.
      expect(repo.registeredPushTokens, ['tok-123']);
      expect(repo.registeredPushSounds, ['tapgo']);

      final container = ProviderScope.containerOf(
          tester.element(find.byType(TapGoDriverApp)));
      await container
          .read(driverAlertToneProvider.notifier)
          .select(DriverAlertTone.panggilan);
      await container
          .read(driverControllerProvider.notifier)
          .refreshPushRegistration();
      await tester.pump(const Duration(seconds: 1));
      expect(repo.registeredPushTokens, ['tok-123', 'tok-123']);
      expect(repo.registeredPushSounds, ['tapgo', 'panggilan']);
    });

    testWidgets(
        'izin ditolak (token null): tidak ada pendaftaran, aplikasi tetap jalan',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await tester.pumpWidget(buildTestableDriverApp(
          repository: repo, pushPlatform: FakePushPlatform(token: null)));
      await tester.pumpAndSettle();
      expect(repo.registeredPushTokens, isEmpty);
      expect(find.byType(DriverShell), findsOneWidget);
    });

    testWidgets(
        'pesan ride_offer memicu penyegaran; jenis tak dikenal diabaikan',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      final before = repo.offersCalls;

      platform.foreground.add(const DriverPushMessage(
          title: 'x', body: 'Pesanan baru', data: {'type': 'evil_action'}));
      await tester.pumpAndSettle();
      expect(repo.offersCalls, before);

      platform.foreground.add(const DriverPushMessage(
          title: 'x',
          body: 'Pesanan baru',
          data: {'type': 'ride_offer', 'rideReference': 'RID-ABCDEF12'}));
      await tester.pumpAndSettle();
      expect(repo.offersCalls, greaterThan(before));
    });

    testWidgets(
        'pesan ride_offer tampil sebagai SnackBar dan TIDAK ikut tertimpa refreshWorkspace berikutnya',
        (tester) async {
      // Regresi nyata (uji driver 28 Sep): pesan sebelumnya lewat
      // state.message, yang ditimpa clearMessage:true oleh refreshWorkspace()
      // yang dipanggil di baris berikutnya — pada jaringan cepat pesan hilang
      // sebelum driver sempat melihatnya. SnackBar (key global) tidak ikut
      // tertimpa oleh perubahan state Riverpod apa pun.
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();

      platform.foreground.add(const DriverPushMessage(
          title: 'Pesanan baru di dekat Anda',
          body: 'Buka aplikasi untuk melihat dan menerima pesanan.',
          data: {'type': 'ride_offer', 'rideReference': 'RID-ABCDEF12'}));
      // BUKAN pumpAndSettle langsung: ingin membuktikan SnackBar masih ada
      // SETELAH refreshWorkspace() yang dipicu pesan yang sama selesai
      // (bukan diperiksa sebelum sempat tertimpa).
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.textContaining('Pesanan baru di dekat Anda'), findsOneWidget);
      expect(find.byType(SnackBar), findsOneWidget);
    });

    testWidgets(
        'pesan latar depan JUGA memicu notifikasi sistem (suara), bukan cuma SnackBar senyap',
        (tester) async {
      // Regresi Owner 29 Sep 2026: "order masuk tapi tidak ada suara dan
      // tidak ada pop up". FCM tidak pernah menampilkan apa pun sendiri saat
      // app di depan — itu perilaku LATAR BELAKANG saja. SnackBar (test di
      // atas) tidak bersuara, jadi driver yang tidak sedang melihat layar
      // tidak akan sadar ada order masuk. showForegroundAlert() menutup
      // celah ini lewat notifikasi sistem asli di channel yang sama dengan
      // notifikasi latar belakang (sudah IMPORTANCE_HIGH + bersuara).
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();

      platform.foreground.add(const DriverPushMessage(
          title: 'Pesanan baru di dekat Anda',
          body: 'Buka aplikasi untuk melihat dan menerima pesanan.',
          data: {'type': 'ride_offer', 'rideReference': 'RID-ABCDEF12'}));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(platform.foregroundAlerts, hasLength(1));
      expect(platform.foregroundAlerts.single.title, 'Pesanan baru di dekat Anda');
    });
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

  group('Google Sign-In: kegagalan sebelum sempat hubungi backend tetap tampil', () {
    test('PlatformException menampilkan kode mentahnya, bukan pesan kosong', () {
      final message = googleSignInFailureMessage(
        PlatformException(code: 'sign_in_failed', message: 'DEVELOPER_ERROR'),
      );
      expect(message, contains('sign_in_failed'));
      expect(message, contains('Masuk dengan Google gagal'));
    });

    test('DriverApiException (mis. token tidak dikembalikan Google) memakai pesannya sendiri', () {
      final message = googleSignInFailureMessage(
        const DriverApiException(code: 'GOOGLE_TOKEN_MISSING', message: 'Google tidak mengembalikan token yang valid.'),
      );
      expect(message, 'Google tidak mengembalikan token yang valid.');
    });

    test('exception tak dikenal tetap menghasilkan pesan (tidak pernah kosong)', () {
      final message = googleSignInFailureMessage(Exception('kegagalan aneh'));
      expect(message, isNotEmpty);
      expect(message, contains('Masuk dengan Google gagal'));
    });

    testWidgets(
        'reportClientSideAuthFailure menampilkan pesan di layar login lewat ErrorNotice yang sama',
        (tester) async {
      final repo = FakeDriverRepository(session: null);
      await tester.pumpWidget(buildTestableDriverApp(repository: repo, scenario: DriverScenario.login));
      await tester.pumpAndSettle();
      expect(find.text('Pilih akun lalu tidak terjadi apa-apa sebelumnya — sekarang tampil.'), findsNothing);

      final container = ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)));
      container.read(driverControllerProvider.notifier).reportClientSideAuthFailure(
          'Pilih akun lalu tidak terjadi apa-apa sebelumnya — sekarang tampil.');
      await tester.pumpAndSettle();
      expect(find.text('Pilih akun lalu tidak terjadi apa-apa sebelumnya — sekarang tampil.'), findsOneWidget);
    });
  });

  group('tab Akun: preferensi, pengajuan mitra, dan bantuan', () {
    testWidgets(
        'driver aktif dengan kendaraan: plat kendaraan tampil di profil, tombol "Ajukan Jadi Mitra Driver" TIDAK tampil',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..applicationInfo = const DriverApplicationInfo(
            id: 'app-1', cycleNumber: 1, status: DriverApplicationStatus.approved);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();

      expect(
          find.descendant(
              of: find.byKey(const ValueKey('account-profile')),
              matching: find.textContaining('Plat:')),
          findsOneWidget);
      expect(find.text('Ajukan Jadi Mitra Driver'), findsNothing);
      expect(find.byKey(const ValueKey('driver-application-entry')), findsNothing);
    });

    testWidgets(
        'driver tanpa kendaraan/pengajuan: tombol "Ajukan Jadi Mitra Driver" tetap tampil',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();

      expect(find.text('Ajukan Jadi Mitra Driver'), findsOneWidget);
      expect(find.text('Kendaraan'), findsNothing);
    });

    testWidgets('Akun gaya daftar berkategori: profil, Pengaturan, Bantuan, lalu Keluar',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('account-profile')), findsOneWidget);
      expect(find.text('Pengaturan'), findsOneWidget);
      expect(find.byKey(const ValueKey('open-appearance')), findsOneWidget);
      expect(find.byKey(const ValueKey('open-notifications')), findsOneWidget);
      // Ringkasan pilihan terlihat di barisnya, tanpa membuka halaman.
      expect(find.text('Ikuti sistem'), findsOneWidget);
      expect(find.text('Bunyi: TapGo'), findsOneWidget);
      // Isi halaman TIDAK menumpuk di tab: pilihan tema dan bunyi baru muncul
      // setelah barisnya diketuk.
      expect(find.byKey(const ValueKey('theme-choice-dark')), findsNothing);
      expect(find.byKey(const ValueKey('tone-lonceng')), findsNothing);
      expect(find.byKey(const ValueKey('open-sound-test')), findsNothing);
      expect(find.text('Uji bunyi'), findsNothing);
    });

    testWidgets('Tampilan: tiga pilihan tema, memilih Gelap langsung mengubah tema aplikasi',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(ProviderScope(
        overrides: [
          driverRepositoryProvider.overrideWithValue(repo),
          locationPortProvider.overrideWithValue(NoDriverLocationPort()),
          testSkipSplashProvider.overrideWithValue(true),
          // testThemeModeProvider SENGAJA tidak di-override: test ini justru
          // memeriksa preferensi tersimpan (driverThemePreferenceProvider),
          // yang kalah dari override itu bila diisi.
        ],
        child: const TapGoDriverApp(),
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('open-appearance')));
      await tester.pumpAndSettle();

      expect(find.byType(DriverAppearanceScreen), findsOneWidget);
      expect(find.byKey(const ValueKey('theme-choice-system')), findsOneWidget);
      expect(find.byKey(const ValueKey('theme-choice-light')), findsOneWidget);
      expect(find.byKey(const ValueKey('theme-choice-dark')), findsOneWidget);

      final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(app.themeMode, ThemeMode.system);

      await tester.tap(find.byKey(const ValueKey('theme-choice-dark')));
      await tester.pumpAndSettle();

      final updated = tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(updated.themeMode, ThemeMode.dark);
    });

    testWidgets('Notifikasi: hanya tiga pilihan bunyi, mengetuk memilih dan langsung membunyikan',
        (tester) async {
      final played = <Object?>[];
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(driverAlertsMethodChannel, (call) async {
        if (call.method == 'playNotificationSound') {
          played.add((call.arguments as Map)['sound']);
          return true;
        }
        return null;
      });
      addTearDown(() => TestWidgetsFlutterBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(driverAlertsMethodChannel, null));
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('open-notifications')));
      await tester.pumpAndSettle();

      expect(find.byType(DriverNotificationScreen), findsOneWidget);
      // Persis tiga baris pilihan; tanpa tombol uji, laporan, atau pengaturan sistem.
      expect(find.byType(ListTile), findsNWidgets(3));
      expect(find.text('TapGo'), findsOneWidget);
      expect(find.text('Lonceng'), findsOneWidget);
      expect(find.text('Panggilan'), findsOneWidget);
      expect(find.byType(OutlinedButton), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byIcon(Icons.radio_button_checked_rounded), findsOneWidget);
      expect(played, isEmpty);

      await tester.tap(find.byKey(const ValueKey('tone-lonceng')));
      await tester.pumpAndSettle();
      expect(played, ['lonceng']);
      expect(
          find.descendant(
              of: find.byKey(const ValueKey('tone-lonceng')),
              matching: find.byIcon(Icons.radio_button_checked_rounded)),
          findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('tone-panggilan')));
      await tester.pumpAndSettle();
      expect(played, ['lonceng', 'panggilan']);
      // Mengetuk lagi pilihan yang sama membunyikannya lagi (seperti nada dering).
      await tester.tap(find.byKey(const ValueKey('tone-panggilan')));
      await tester.pumpAndSettle();
      expect(played, ['lonceng', 'panggilan', 'panggilan']);

      // Kembali ke Akun: ringkasan ikut berubah.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Bunyi: Panggilan'), findsOneWidget);
    });

    testWidgets('Bantuan: WhatsApp dan Kebijakan Privasi tersedia, Keluar memanggil logout',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();

      await tester.dragUntilVisible(
        find.byKey(const ValueKey('support-whatsapp')),
        find.byType(ListView),
        const Offset(0, -200),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('support-whatsapp')), findsOneWidget);
      expect(find.text('+62 838-0025-5588'), findsOneWidget);
      expect(find.byKey(const ValueKey('support-privacy-policy')), findsOneWidget);

      await tapReachable(tester, find.byKey(const ValueKey('account-logout')));
      await tester.pumpAndSettle();
      expect(repo.logoutCalls, 1);
    });
  });

  group('uji HP 5 Okt 2026: bunyi order, popup chat, polling chat, pesan cepat', () {
    const rideRef = 'RID-A2B3C4D5E6';

    setUp(driverResetChatUiForTests);
    tearDown(driverResetChatUiForTests);

    DriverRide offerRide(String reference, {DateTime? updatedAt}) => DriverRide(
          reference: reference,
          serviceType: 'MOTORCYCLE',
          status: RideStatus.searchingDriver,
          pickupAddress: 'JEMPUT_$reference',
          dropoffAddress: 'TUJUAN_$reference',
          distanceMeters: 2500,
          durationSeconds: 600,
          totalFare: 9000,
          updatedAt: updatedAt,
        );

    Future<void> pumpWith(
      WidgetTester tester,
      FakeDriverRepository repo, {
      FakePushPlatform? platform,
      Size size = const Size(390, 844),
    }) async {
      await tester.binding.setSurfaceSize(size);
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });
    }

    DriverController controllerOf(WidgetTester tester) =>
        ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
            .read(driverControllerProvider.notifier);

    Future<void> openChat(WidgetTester tester,
        {Duration pollInterval = const Duration(seconds: 4)}) async {
      driverNavigatorKey.currentState!.push(MaterialPageRoute<void>(
        builder: (_) =>
            RideChatScreen(rideReference: rideRef, pollInterval: pollInterval),
      ));
      await tester.pumpAndSettle();
    }

    Map<String, dynamic> passengerMessage(String id, String text) =>
        {'id': id, 'senderType': 'USER', 'message': text};

    const chatPush = DriverPushMessage(
      title: 'Pesan baru dari penumpang',
      body: 'Ketuk untuk membaca.',
      data: {'type': 'chat_message', 'rideReference': rideRef},
    );

    Future<void> poll(WidgetTester tester) async {
      await tester.pump(const Duration(seconds: 12));
      await tester.pump(const Duration(milliseconds: 50));
    }

    // ---------------- 1. bunyi order masuk ----------------

    testWidgets('lembar tawaran terbuka dari POLLING: berbunyi (notifikasi lokal channel yang sama)',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);
      expect(platform.foregroundAlerts, isEmpty);

      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      await poll(tester);

      expect(find.byType(OfferDetailSheet), findsOneWidget);
      expect(platform.foregroundAlerts, hasLength(1));
      expect(platform.foregroundAlerts.single.title, 'Order baru');
      expect(platform.foregroundAlerts.single.data['type'], 'ride_offer');
    });

    testWidgets('order lewat PUSH latar depan + lembar yang terbuka: tepat SATU bunyi',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);

      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      platform.foreground.add(const DriverPushMessage(
        title: 'Order baru',
        body: 'Ada penumpang di dekat Anda',
        data: {'type': 'ride_offer', 'rideReference': 'RID-A2B3C4D5E7'},
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.byType(OfferDetailSheet), findsOneWidget);
      // Polling berikutnya tidak membunyikan lagi tawaran yang sama.
      await poll(tester);
      expect(platform.foregroundAlerts, hasLength(1));
    });

    testWidgets('dua tawaran berbeda: masing-masing berbunyi saat lembarnya terbuka; ketuk manual tidak berbunyi',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);

      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      await poll(tester);
      expect(platform.foregroundAlerts, hasLength(1));

      // Tutup lalu tawaran kedua datang.
      controllerOf(tester).closeOffer();
      await tester.pumpAndSettle();
      repo.offerItems = [offerRide('RID-A2B3C4D5E7'), offerRide('RID-A2B3C4D5E8')];
      await poll(tester);
      expect(platform.foregroundAlerts, hasLength(2));

      // Ketuk manual pada tawaran yang sudah ada tidak membunyikan apa pun.
      controllerOf(tester).closeOffer();
      await tester.pumpAndSettle();
      final before = platform.foregroundAlerts.length;
      controllerOf(tester).selectOffer(offerRide('RID-A2B3C4D5E7'));
      await tester.pumpAndSettle();
      expect(platform.foregroundAlerts.length, before);
    });

    // ---------------- 2. popup chat ----------------

    testWidgets('chat masuk saat layar chat TIDAK terbuka: popup + bunyi, tanpa isi pesan; Buka chat membuka chat',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);

      platform.foreground.add(chatPush);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
      expect(find.text('Pesan baru dari penumpang'), findsWidgets);
      expect(platform.foregroundAlerts, hasLength(1));
      expect(platform.foregroundAlerts.single.title, 'Pesan baru dari penumpang');
      expect(platform.foregroundAlerts.single.body, 'Ketuk untuk membaca.');

      await tester.tap(find.byKey(const ValueKey('chat-popup-open')));
      await tester.pumpAndSettle();
      expect(find.byType(RideChatScreen), findsOneWidget);
      expect(driverOpenChatReference, rideRef);
    });

    testWidgets('chat masuk saat layar chat perjalanan itu SUDAH terbuka: hanya masuk daftar, tanpa popup dan tanpa bunyi',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);
      await openChat(tester, pollInterval: Duration.zero);

      repo.chatItems = [passengerMessage('m1', 'Saya di depan toko')];
      platform.foreground.add(chatPush);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(platform.foregroundAlerts, isEmpty);
    });

    testWidgets('pesan chat beruntun tidak menumpuk popup', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);
      platform.foreground.add(chatPush);
      platform.foreground.add(chatPush);
      platform.foreground.add(chatPush);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets('Nanti menutup popup tanpa membuka chat', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);
      platform.foreground.add(chatPush);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('chat-popup-later')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(find.byType(RideChatScreen), findsNothing);
    });

    testWidgets('referensi perjalanan tidak sah pada push chat: diabaikan', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);
      platform.foreground.add(const DriverPushMessage(
        title: 'Pesan baru dari penumpang',
        body: 'x',
        data: {'type': 'chat_message', 'rideReference': '../admin'},
      ));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(platform.foregroundAlerts, isEmpty);
    });

    testWidgets('notifikasi chat yang diketuk (latar belakang) membuka layar chat',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = FakePushPlatform(token: 'tok');
      await pumpWith(tester, repo, platform: platform);
      platform.opened.add(chatPush);
      await tester.pumpAndSettle();
      expect(find.byType(RideChatScreen), findsOneWidget);
    });

    // ---------------- 2b. polling REST di chat driver ----------------

    testWidgets('selama chat terbuka pesan penumpang diambil tiap 4 detik tanpa duplikat; dibaca-tandai',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      await openChat(tester);
      expect(find.text('Halo, saya di gerbang'), findsNothing);
      final fetchesAtOpen = repo.chatFetchCalls;

      repo.chatItems = [passengerMessage('m1', 'Halo, saya di gerbang')];
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(milliseconds: 50));
      expect(repo.chatFetchCalls, greaterThan(fetchesAtOpen));
      expect(find.text('Halo, saya di gerbang'), findsOneWidget);
      expect(repo.chatMarkReadCalls, greaterThan(0));

      // Polling berikutnya membawa pesan yang sama + satu pesan baru: tanpa duplikat.
      repo.chatItems = [
        passengerMessage('m1', 'Halo, saya di gerbang'),
        passengerMessage('m2', 'Pakai jaket merah'),
      ];
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('Halo, saya di gerbang'), findsOneWidget);
      expect(find.text('Pakai jaket merah'), findsOneWidget);
    });

    testWidgets('selang polling 0 mematikan polling', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      await openChat(tester, pollInterval: Duration.zero);
      final fetches = repo.chatFetchCalls;
      await tester.pump(const Duration(seconds: 20));
      expect(repo.chatFetchCalls, fetches);
    });

    testWidgets('polling berhenti setelah layar chat ditutup', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      await openChat(tester);
      driverNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      expect(driverOpenChatReference, isNull);
      final fetches = repo.chatFetchCalls;
      await tester.pump(const Duration(seconds: 20));
      expect(repo.chatFetchCalls, fetches);
    });

    // ---------------- 3. pesan cepat ----------------

    testWidgets('chip pesan cepat dari sisi DRIVER tampil; kalimat penumpang tidak', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      // Lebar layar cukup agar keempat chip (daftar horizontal malas) terbangun.
      await pumpWith(tester, repo, size: const Size(1400, 844));
      await openChat(tester, pollInterval: Duration.zero);
      for (final text in driverQuickReplies) {
        expect(find.text(text), findsOneWidget);
      }
      expect(driverQuickReplies, [
        'Saya menuju titik jemput',
        'Saya sudah sampai',
        'Mohon tunggu sebentar',
        'Baik, saya mengerti',
      ]);
      for (final passengerText in [
        'Saya sudah di titik jemput',
        'Tunggu sebentar ya',
        'Saya di seberang jalan',
        'Terima kasih',
      ]) {
        expect(find.text(passengerText), findsNothing);
      }
    });

    testWidgets('mengetuk chip mengirim lewat jalur kirim yang ada; pesan tampil sekali',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo, size: const Size(1400, 844));
      await openChat(tester, pollInterval: Duration.zero);
      await tester.tap(find.byKey(const ValueKey('driver_quick_reply_1')));
      await tester.pumpAndSettle();
      expect(repo.sentChat, ['Saya sudah sampai']);
      // Satu di daftar chat (bubble) + satu pada chip.
      expect(find.text('Saya sudah sampai'), findsNWidgets(2));
    });

    // ---------------- 8. tanpa badge Offline ----------------

    testWidgets('chat driver tidak menampilkan label Offline/Live dan tidak mengubah ketersediaan',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      final availabilityBefore =
          ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
              .read(driverControllerProvider)
              .availability;
      await openChat(tester, pollInterval: Duration.zero);

      expect(find.textContaining('Offline'), findsNothing);
      expect(find.textContaining('Live'), findsNothing);
      expect(find.text('Chat Penumpang'), findsOneWidget);
      // Membuka chat tidak mengubah ketersediaan driver.
      expect(
          ProviderScope.containerOf(tester.element(find.byType(RideChatScreen)))
              .read(driverControllerProvider)
              .availability,
          availabilityBefore);
      expect(repo.availabilityRequests, isEmpty);
    });

    // ---------------- bunyi nyata: ringtone (platform asli, native di-mock) ----------------

    testWidgets('ringtone: order dari polling diputar SEKALI per referensi, polling berikutnya tidak mengulang',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      await poll(tester);
      expect(find.byType(OfferDetailSheet), findsOneWidget);
      expect(platform.ringtone, hasLength(1));
      expect(platform.shown, isEmpty);

      await poll(tester);
      await poll(tester);
      expect(platform.ringtone, hasLength(1));
    });

    testWidgets('ringtone: push + lembar yang terbuka untuk referensi yang sama = SATU ringtone',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      platform.fcm.add(const DriverPushMessage(
        title: 'Order baru',
        body: 'Ada penumpang di dekat Anda',
        data: {'type': 'ride_offer', 'rideReference': 'RID-A2B3C4D5E7'},
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await poll(tester);
      expect(find.byType(OfferDetailSheet), findsOneWidget);
      expect(platform.ringtone, hasLength(1));
      expect(platform.shown, isEmpty);
    });

    testWidgets('ringtone chat: layar chat TERBUKA tidak berbunyi dan tidak berpopup; TIDAK terbuka berbunyi sekali + popup',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      // Layar chat perjalanan itu terbuka.
      driverNavigatorKey.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => const RideChatScreen(
            rideReference: rideRef, pollInterval: Duration.zero),
      ));
      await tester.pumpAndSettle();
      platform.fcm.add(chatPush);
      await tester.pumpAndSettle();
      expect(platform.ringtone, isEmpty);
      expect(platform.shown, isEmpty);
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);

      // Layar ditutup: pesan berikutnya berbunyi sekali dan berpopup.
      driverNavigatorKey.currentState!.pop();
      await tester.pumpAndSettle();
      platform.fcm.add(chatPush);
      await tester.pumpAndSettle();
      expect(platform.ringtone, hasLength(1));
      expect(platform.shown, isEmpty);
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets('di belakang: peristiwa memakai notifikasi channel tapgo_alerts_v3, bukan tapgo_default, dan tanpa ringtone',
        (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      final platform = RingtoneProbePlatform(foreground: false);
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      await poll(tester);
      expect(platform.ringtone, isEmpty);
      expect(platform.shown, hasLength(1));
      final android = platform.shown.single.android!;
      expect(android.channelId, 'tapgo_alerts_v3');
      expect(android.channelId, isNot('tapgo_default'));
      expect(android.playSound, isTrue);
    });

    // ---------------- Banner notifikasi mati ----------------

    testWidgets('Beranda: notifikasi dimatikan → banner dengan tombol pengaturan', (tester) async {
      driverNotificationsEnabledForTests = () async => false;
      addTearDown(() => driverNotificationsEnabledForTests = null);
      await pumpWith(tester, FakeDriverRepository(session: demoSession));
      expect(find.byKey(const ValueKey('notifications-off-banner')), findsOneWidget);
      expect(find.text('Nyalakan Notifikasi'), findsOneWidget);
    });

    testWidgets('Beranda: notifikasi diizinkan → tidak ada banner', (tester) async {
      driverNotificationsEnabledForTests = () async => true;
      addTearDown(() => driverNotificationsEnabledForTests = null);
      await pumpWith(tester, FakeDriverRepository(session: demoSession));
      expect(find.byKey(const ValueKey('notifications-off-banner')), findsNothing);
    });

    // ---------------- Chat tanpa FCM: pemantau kotak masuk ----------------

    Map<String, dynamic> inboxRow(String reference, int unread) => {
          'rideReference': reference,
          'status': 'DRIVER_TO_PICKUP',
          'canSend': true,
          'unreadCount': unread,
          'lastMessage': {'text': 'rahasia', 'senderType': 'USER'},
        };

    // Jam palsu untuk penjaga waktu peringatan chat (DateTime.now() tidak ikut
    // waktu palsu flutter_test); tiap putaran memajukannya 6 detik.
    var fakeNow = DateTime(2026, 10, 6, 12);
    setUp(() {
      fakeNow = DateTime(2026, 10, 6, 12);
      driverClockForTests = () => fakeNow;
    });
    tearDown(() => driverClockForTests = DateTime.now);

    Future<void> chatPoll(WidgetTester tester) async {
      fakeNow = fakeNow.add(const Duration(seconds: 6));
      await tester.pump(const Duration(seconds: 6));
      await tester.pump(const Duration(milliseconds: 50));
    }

    testWidgets('pesan masuk TANPA push: popup + satu bunyi + titik merah, isi pesan tidak tampil', (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession, current: demoRide(RideStatus.driverToPickup));
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);

      repo.chatConversationRows = [inboxRow('RIDE-DEMO-001', 1)];
      await chatPoll(tester);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
      expect(find.text('rahasia'), findsNothing);
      expect(platform.ringtone, hasLength(1));
      // Titik merah pada tab Pesanan.
      expect(tester.widget<Badge>(find.byKey(const ValueKey('orders-tab-badge'))).isLabelVisible, isTrue);
      expect(ProviderScope.containerOf(tester.element(find.byType(TapGoDriverApp)))
          .read(driverControllerProvider).chatUnread, {'RIDE-DEMO-001': 1});
    });

    testWidgets('hitungan sama tidak memperingatkan lagi; naik = peringatan baru', (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession, current: demoRide(RideStatus.driverToPickup));
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      repo.chatConversationRows = [inboxRow('RIDE-DEMO-001', 1)];
      await chatPoll(tester);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('chat-popup-later')));
      await tester.pumpAndSettle();
      expect(platform.ringtone, hasLength(1));

      // Beberapa putaran dengan hitungan tetap: tidak ada peringatan lagi.
      await chatPoll(tester);
      await chatPoll(tester);
      expect(platform.ringtone, hasLength(1));
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);

      // Pesan berikutnya (≥ 8 detik kemudian): hitungan naik → peringatan baru.
      repo.chatConversationRows = [inboxRow('RIDE-DEMO-001', 2)];
      await chatPoll(tester);
      await tester.pumpAndSettle();
      expect(platform.ringtone, hasLength(2));
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets('push dan kotak masuk untuk pesan yang sama: SATU peringatan', (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession, current: demoRide(RideStatus.driverToPickup));
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });

      platform.fcm.add(const DriverPushMessage(
        title: 'Pesan baru dari penumpang',
        body: 'Ketuk untuk membaca.',
        data: {'type': 'chat_message', 'rideReference': 'RID-A2B3C4D5E6'},
      ));
      repo.chatConversationRows = [inboxRow('RID-A2B3C4D5E6', 1)];
      await tester.pump();
      await chatPoll(tester);
      await tester.pumpAndSettle();
      expect(platform.ringtone, hasLength(1));
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets('layar chat perjalanan itu terbuka: tanpa peringatan dan tanpa titik merah', (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession, current: demoRide(RideStatus.driverToPickup));
      final platform = RingtoneProbePlatform();
      await tester.binding.setSurfaceSize(const Size(390, 844));
      await tester.pumpWidget(
          buildTestableDriverApp(repository: repo, pushPlatform: platform));
      await tester.pumpAndSettle();
      addTearDown(() async {
        await tester.binding.setSurfaceSize(null);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      });
      driverNavigatorKey.currentState!.push(MaterialPageRoute<void>(
        builder: (_) => const RideChatScreen(
            rideReference: 'RIDE-DEMO-001', pollInterval: Duration.zero),
      ));
      await tester.pumpAndSettle();

      repo.chatConversationRows = [inboxRow('RIDE-DEMO-001', 3)];
      await chatPoll(tester);
      await tester.pumpAndSettle();
      expect(platform.ringtone, isEmpty);
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(ProviderScope.containerOf(tester.element(find.byType(RideChatScreen)))
          .read(driverControllerProvider).chatUnread, isEmpty);
    });

    testWidgets('tanpa perjalanan aktif: kotak masuk tidak dipanggil sama sekali', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      repo.chatConversationRows = [inboxRow('RIDE-DEMO-001', 5)];
      await tester.pump(const Duration(seconds: 30));
      expect(repo.chatConversationCalls, 0);
    });

    testWidgets('tombol chat di perjalanan aktif menampilkan titik merah dan teks pesan baru', (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession, current: demoRide(RideStatus.driverToPickup));
      repo.chatConversationRows = [inboxRow('RIDE-DEMO-001', 2)];
      await pumpWith(tester, repo);
      await tester.pump(const Duration(seconds: 6));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('chat-popup-later')));
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.receipt_long_rounded));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('trip-chat-badge')), findsOneWidget);
      expect(find.text('Chat dengan Penumpang (pesan baru)'), findsOneWidget);
    });

    // ---------------- Performa: poll tanpa perubahan tidak membangun ulang layar ----------------
    //
    // Baseline terukur sebelum perbaikan (6 Okt 2026, flutter test + debugOnRebuildDirtyWidget):
    // 3 poll 12 detik tanpa perubahan data = 1135 rebuild elemen di Beranda dan 1134 di tab
    // Pesanan (≈378 per poll). Penyebab: poll membuat objek DriverState baru bernilai sama dan
    // StateNotifier memberi tahu pendengar bila identitasnya berbeda; seluruh layar menonton
    // seluruh state.

    Future<int> countIdlePollRebuilds(WidgetTester tester, {int polls = 3}) async {
      // Satu poll pemanasan menyerap perubahan nyata pertama (mis. isu lokasi).
      await poll(tester);
      var rebuilds = 0;
      final previous = debugOnRebuildDirtyWidget;
      debugOnRebuildDirtyWidget = (element, builtOnce) => rebuilds += 1;
      addTearDown(() => debugOnRebuildDirtyWidget = previous);
      for (var i = 0; i < polls; i++) {
        await poll(tester);
      }
      debugOnRebuildDirtyWidget = previous;
      return rebuilds;
    }

    testWidgets('PERFORMA: 3 poll tanpa perubahan data tidak membangun ulang layar Beranda', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      final rebuilds = await countIdlePollRebuilds(tester);
      expect(rebuilds, lessThanOrEqualTo(10), reason: 'baseline sebelum perbaikan: 1135');
    });

    testWidgets('PERFORMA: 3 poll tanpa perubahan data tidak membangun ulang tab Pesanan (2 tawaran)', (tester) async {
      final repo = FakeDriverRepository(
          session: demoSession,
          offerItems: [offerRide('RID-A2B3C4D5E7'), offerRide('RID-A2B3C4D5E8')]);
      await pumpWith(tester, repo);
      await poll(tester);
      controllerOf(tester).closeOffer();
      await tester.pumpAndSettle();
      controllerOf(tester).closeOffer();
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.receipt_long_rounded));
      await tester.pumpAndSettle();
      final rebuilds = await countIdlePollRebuilds(tester);
      expect(rebuilds, lessThanOrEqualTo(10), reason: 'baseline sebelum perbaikan: 1134');
    });

    testWidgets('PERFORMA: data yang BENAR-BENAR berubah tetap membangun ulang (tawaran baru muncul)', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      await poll(tester);
      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      await poll(tester);
      expect(find.byType(OfferDetailSheet), findsOneWidget);
    });

    testWidgets('PERFORMA: tawaran dan availability dimuat BERSAMAAN (bukan berurutan)', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpWith(tester, repo);
      repo.offersDelay = const Duration(milliseconds: 100);
      repo.availabilityDelay = const Duration(milliseconds: 100);
      repo.offerItems = [offerRide('RID-A2B3C4D5E7')];
      unawaited(controllerOf(tester).refreshWorkspace());
      // Berurutan butuh 200 ms; bersamaan cukup ±100 ms.
      await tester.pump(const Duration(milliseconds: 120));
      await tester.pump();
      expect(find.byType(OfferDetailSheet), findsOneWidget);
    });

    testWidgets('PERFORMA: selang polling 12 dtk di depan, 30 dtk di latar belakang (Online), kembali 12 dtk saat dibuka', (tester) async {
      final repo = FakeDriverRepository(session: demoSession)..availability = DriverAvailability.online;
      await pumpWith(tester, repo);
      await poll(tester);
      expect(controllerOf(tester).pollIntervalForTests, const Duration(seconds: 12));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(controllerOf(tester).pollIntervalForTests, const Duration(seconds: 30));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();
      expect(controllerOf(tester).pollIntervalForTests, const Duration(seconds: 12));
    });
  });
}

Future<void> pumpDriver(
  WidgetTester tester,
  FakeDriverRepository repo, {
  DriverLocationPort? locationPort,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  await tester.pumpWidget(
      buildTestableDriverApp(repository: repo, locationPort: locationPort));
  await tester.pumpAndSettle();
  addTearDown(() async {
    await tester.binding.setSurfaceSize(null);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}

/// Sama seperti [pumpDriver], lalu pindah ke tab "Pesanan" — tawaran,
/// perjalanan aktif, dan riwayat kini hidup di sana, bukan di Beranda.
Future<void> pumpDriverOrders(WidgetTester tester, FakeDriverRepository repo) async {
  await pumpDriver(tester, repo);
  // Lewat ikon, bukan find.text('Pesanan'): pumpWidget berulang dalam satu
  // test dapat mempertahankan _tabIndex sebelumnya (elemen root tidak
  // berubah tipe), sehingga judul layar "Pesanan" bisa sudah tampil
  // berdampingan dengan label NavigationDestination yang sama persis.
  await tester.tap(find.byIcon(Icons.receipt_long_rounded));
  await tester.pumpAndSettle();
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

/// Menggulir naskah pernyataan sampai akhir; kotak persetujuan baru aktif setelah itu.
Future<void> readDeclarationToEnd(WidgetTester tester) async {
  final scrollable = find
      .ancestor(
        of: find.byKey(const ValueKey('driver-terms')),
        matching: find.byType(Scrollable),
      )
      .first;
  for (var i = 0; i < 3; i++) {
    await tester.drag(scrollable, const Offset(0, -20000));
    await tester.pumpAndSettle();
  }
}

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

/// Sama seperti [demoRide], plus koordinat+nama penumpang — dipakai untuk
/// menguji peta/tombol navigasi/nama penumpang pada ActiveRideCard.
DriverRide demoRideWithLocation(RideStatus status) => DriverRide(
      reference: 'RIDE-DEMO-001',
      serviceType: 'MOTORCYCLE',
      status: status,
      pickupAddress: 'LOKASI_DEMO_A',
      dropoffAddress: 'LOKASI_DEMO_B',
      pickupLat: -6.1754,
      pickupLng: 106.8272,
      dropoffLat: -6.1854,
      dropoffLng: 106.8372,
      passengerName: 'Sari',
      distanceMeters: 2500,
      durationSeconds: 600,
      totalFare: 9000,
    );

class FakeDriverRepository implements DriverRepository {
  String? lastCancelReason;
  final List<String> registeredPushTokens = [];
  final List<String> registeredPushSounds = [];
  final List<String> unregisteredPushTokens = [];

  @override
  Future<void> registerPushToken(String token, {String? sound}) async {
    registeredPushTokens.add(token);
    registeredPushSounds.add(sound ?? '');
  }

  @override
  Future<void> unregisterPushToken(String token) async =>
      unregisteredPushTokens.add(token);

  int webPasswordCalls = 0;
  String? lastWebPasswordIdToken;
  String? lastWebPassword;
  DriverApiException? webPasswordError;

  @override
  Future<void> setWebPasswordWithGoogle({
    required String idToken,
    required String newPassword,
  }) async {
    webPasswordCalls += 1;
    lastWebPasswordIdToken = idToken;
    lastWebPassword = newPassword;
    if (webPasswordError != null) throw webPasswordError!;
  }

  FakeDriverRepository({
    required this.session,
    this.current,
    this.offerItems = const [],
    this.historyItems = const [],
    this.earningsSummaryResult,
    this.performanceSummaryResult,
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
  List<DriverRide> historyItems;
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
  Future<GoogleAuthResult> loginWithGoogle({required String idToken}) async {
    return const GoogleAuthResult.needsPhone(suggestedFullName: 'Fake Google User');
  }

  @override
  Future<DriverSession> completeGoogleRegistration({
    required String idToken,
    required String phone,
    String? fullName,
  }) async {
    session = demoSession;
    return demoSession;
  }

  @override
  Future<void> logout() async {
    logoutCalls += 1;
    session = null;
  }

  /// GET /driver/availability: availability menurut SERVER (field [availability]).
  int availabilityGetCalls = 0;
  DriverApiException? availabilityGetError;

  @override
  Future<DriverAvailability> fetchAvailability() async {
    availabilityGetCalls += 1;
    if (availabilityDelay > Duration.zero) await Future<void>.delayed(availabilityDelay);
    if (availabilityGetError != null) throw availabilityGetError!;
    return availability;
  }

  @override
  Future<DriverAvailability> setAvailability(
      DriverAvailability availability) async {
    availabilityRequests.add(availability);
    this.availability = availability;
    return availabilityCompleter?.future ?? availability;
  }

  /// Latensi buatan (waktu palsu flutter_test) untuk menguji paralelisme refresh.
  Duration offersDelay = Duration.zero;
  Duration availabilityDelay = Duration.zero;

  @override
  Future<List<DriverRide>> offers() async {
    offersCalls += 1;
    if (offersDelay > Duration.zero) await Future<void>.delayed(offersDelay);
    if (offersError != null) throw offersError!;
    return offerItems;
  }

  @override
  Future<DriverRide?> currentRide() async {
    currentRideCalls += 1;
    if (currentError != null) throw currentError!;
    return current;
  }

  int historyCalls = 0;
  DriverApiException? historyError;

  @override
  Future<List<DriverRide>> rideHistory({int limit = 20}) async {
    historyCalls += 1;
    if (historyError != null) throw historyError!;
    return historyItems.take(limit).toList();
  }

  DriverEarningsSummary? earningsSummaryResult;
  Object? earningsError;
  int earningsCalls = 0;

  DriverWalletSummary? walletResult;
  Object? walletError;

  int walletCalls = 0;

  @override
  Future<DriverWalletSummary> walletSummary() async {
    walletCalls += 1;
    if (walletError != null) throw walletError!;
    return walletResult ??
        const DriverWalletSummary(
          balance: 0,
          commissionEnabled: false,
          commissionPercent: 8,
          topUpUrl: 'https://tapgolion.id/topup',
          entries: [],
        );
  }

  @override
  Future<DriverEarningsSummary> earningsSummary({String range = 'today'}) async {
    earningsCalls += 1;
    if (earningsError != null) throw earningsError!;
    return earningsSummaryResult ??
        const DriverEarningsSummary(
          range: 'today',
          tripCount: 0,
          grossFare: 0,
          currency: 'IDR',
          byDay: [],
        );
  }

  DriverPerformanceSummary? performanceSummaryResult;
  Object? performanceError;
  int performanceCalls = 0;

  List<DriverSupportTicket> ticketsResult = const [];
  final createdTickets = <(String, String, String)>[];
  Object? createTicketError;

  @override
  Future<List<DriverSupportTicket>> supportTickets() async => ticketsResult;

  @override
  Future<void> createSupportTicket({
    required String category,
    required String subject,
    required String message,
  }) async {
    if (createTicketError != null) throw createTicketError!;
    createdTickets.add((category, subject, message));
  }

  DriverRatingsSummary ratingsSummaryResult = const DriverRatingsSummary();
  int ratingsCalls = 0;

  @override
  Future<DriverRatingsSummary> ratingsSummary() async {
    ratingsCalls += 1;
    return ratingsSummaryResult;
  }

  @override
  Future<DriverPerformanceSummary> performanceSummary() async {
    performanceCalls += 1;
    if (performanceError != null) throw performanceError!;
    return performanceSummaryResult ??
        const DriverPerformanceSummary(totalTrips: 0);
  }

  @override
  Future<DriverRide> accept(String reference) async {
    acceptCalls += 1;
    if (acceptError != null) throw acceptError!;
    current = await (acceptCompleter?.future ??
        Future.value(demoRide(RideStatus.driverToPickup)));
    availability = DriverAvailability.busy; // server: acceptOrder -> BUSY
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

  final ratedPassengers = <(String, int, String?)>[];
  Object? ratePassengerError;

  @override
  Future<void> ratePassenger(String reference, int stars, {String? note}) async {
    if (ratePassengerError != null) throw ratePassengerError!;
    ratedPassengers.add((reference, stars, note));
  }

  @override
  Future<DriverRide> complete(String reference) async {
    completeCalls += 1;
    // Server: perjalanan selesai tidak lagi "saat ini" (hanya status aktif),
    // dan releaseDriver mengembalikan profil BUSY -> ONLINE.
    current = null;
    availability = DriverAvailability.online;
    return demoRide(RideStatus.completed);
  }

  @override
  Future<DriverRide> cancel(String reference, String reason) async {
    cancelCalls += 1;
    lastCancelReason = reason;
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
  final List<Map<String, Object?>> submittedForms = [];

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
    String? fullName,
    String? dateOfBirth,
    String? address,
    String? emergencyContactName,
    String? emergencyContactPhone,
    required bool declarationAccepted,
    String? declarationVersion,
  }) async {
    if (submitError != null) throw submitError!;
    submitCalls += 1;
    submittedForms.add({
      'serviceType': serviceType,
      'plateNumber': plateNumber,
      'brand': brand,
      'model': model,
      'color': color,
      'fullName': fullName,
      'dateOfBirth': dateOfBirth,
      'address': address,
      'emergencyContactName': emergencyContactName,
      'emergencyContactPhone': emergencyContactPhone,
      'declarationAccepted': declarationAccepted,
      'declarationVersion': declarationVersion,
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

  /// Kotak masuk chat yang dikembalikan server (GET /chat/conversations).
  List<Map<String, dynamic>> chatConversationRows = [];
  int chatConversationCalls = 0;

  @override
  Future<List<Map<String, dynamic>>> chatConversations() async {
    chatConversationCalls += 1;
    return List.of(chatConversationRows);
  }

  /// Isi chat yang dikembalikan server (diubah uji untuk mensimulasikan pesan masuk).
  List<Map<String, dynamic>> chatItems = [];
  int chatFetchCalls = 0;
  int chatMarkReadCalls = 0;
  final List<String> sentChat = [];

  @override
  Future<List<Map<String, dynamic>>> chatMessages(String rideReference) async {
    chatFetchCalls += 1;
    return List.of(chatItems);
  }

  @override
  Future<void> sendChatMessage(String rideReference, String message) async {
    sentChat.add(message);
    chatItems.add({
      'id': 'sent-${sentChat.length}',
      'senderType': 'DRIVER',
      'message': message,
    });
  }

  @override
  Future<void> markChatRead(String rideReference) async {
    chatMarkReadCalls += 1;
  }

  int sendLocationCalls = 0;

  @override
  Future<void> sendLocation({
    required double lat,
    required double lng,
    required int accuracyMeters,
    required DateTime capturedAt,
  }) async {
    sendLocationCalls += 1;
  }

  final List<Map<String, dynamic>> sosCalls = [];
  Object? sosError;

  @override
  Future<void> triggerSos({
    required double lat,
    required double lng,
    int? accuracyMeters,
    String? rideReference,
  }) async {
    if (sosError != null) throw sosError!;
    sosCalls.add({
      'lat': lat,
      'lng': lng,
      'accuracyMeters': accuracyMeters,
      'rideReference': rideReference,
    });
  }

  DriverFaceCheckStatus faceCheckStatus = DriverFaceCheckStatus.passed;

  @override
  Future<DriverFaceCheckSnapshot> faceCheckToday() async =>
      DriverFaceCheckSnapshot(status: faceCheckStatus, attemptsRemaining: 3);

  @override
  Future<DriverFaceReferenceEmbedding> faceCheckReference() async =>
      const DriverFaceReferenceEmbedding(embedding: [], modelVersion: 'test', minSimilarity: 0.75);

  @override
  Future<DriverFaceCheckSnapshot> submitFaceCheckAttempt({
    required double similarityScore,
    required bool livenessPassed,
    required String modelVersion,
  }) async {
    faceCheckStatus = DriverFaceCheckStatus.passed;
    return DriverFaceCheckSnapshot(status: faceCheckStatus, attemptsRemaining: 3);
  }

  // --- Keselamatan selama online (kelelahan + verifikasi ulang) ----------

  DriverFatigueStatus fatigueStatus =
      const DriverFatigueStatus(continuousOnlineMinutes: 0, thresholdMinutes: null, restRequired: false);
  bool faceRecheckDue = false;
  Object? recheckError;
  int safetyStatusCalls = 0;
  int recheckAttemptCalls = 0;

  @override
  Future<DriverSafetyStatus> safetyStatus() async {
    safetyStatusCalls += 1;
    return DriverSafetyStatus(fatigue: fatigueStatus, faceRecheckDue: faceRecheckDue);
  }

  @override
  Future<DriverFaceCheckSnapshot> submitRecheckAttempt({
    required double similarityScore,
    required bool livenessPassed,
    required String modelVersion,
  }) async {
    recheckAttemptCalls += 1;
    if (recheckError != null) throw recheckError!;
    faceRecheckDue = false;
    return const DriverFaceCheckSnapshot(status: DriverFaceCheckStatus.passed, attemptsRemaining: 3);
  }
}

class RecordingLocationPort implements DriverLocationPort {
  RecordingLocationPort({
    required this.available,
    Stream<(double, double)>? fixes,
    DriverLocationAvailability? availabilityStatus,
  })  : availabilityStatus = availabilityStatus ??
            (available
                ? DriverLocationAvailability.available
                : DriverLocationAvailability.permissionDenied),
        positionStream = fixes ?? const Stream.empty();
  final bool available;
  // BUKAN final — beberapa test mengubahnya di tengah jalan untuk meniru
  // izin/GPS yang hilang SETELAH driver online (lihat test "izin lokasi
  // hilang di tengah sesi online").
  DriverLocationAvailability availabilityStatus;
  int sendCalls = 0;
  int startTrackingCalls = 0;
  int stopTrackingCalls = 0;

  /// Riwayat permintaan mode GPS cepat (true = menuju titik jemput).
  final List<bool> fastTrackingRequests = [];

  /// Bila diisi, sendCurrentLocation menunggu di sini (meniru jaringan lambat).
  Completer<void>? sendGate;
  int sendInFlight = 0;
  int maxSendInFlight = 0;

  @override
  Future<void> startTracking() async {
    startTrackingCalls += 1;
  }

  @override
  Future<void> stopTracking() async {
    stopTrackingCalls += 1;
  }

  @override
  Future<bool> get isAvailable async => availabilityStatus.isAvailable;

  @override
  Future<DriverLocationAvailability> checkAvailability() async => availabilityStatus;

  @override
  Future<void> setFastTracking(bool fast) async {
    fastTrackingRequests.add(fast);
  }

  @override
  Future<void> sendCurrentLocation() async {
    sendCalls += 1;
    sendInFlight += 1;
    if (sendInFlight > maxSendInFlight) maxSendInFlight = sendInFlight;
    try {
      await sendGate?.future;
    } finally {
      sendInFlight -= 1;
    }
  }

  // Null secara default meniru GPS/izin belum siap; test SOS mengisinya.
  DriverLocationFix? fix;

  @override
  Future<DriverLocationFix?> currentFix() async => fix;

  @override
  final Stream<(double lat, double lng)> positionStream;
}

/// Platform push asli (ringtone dan notifikasi lokal di-mock) dengan aliran FCM
/// yang dikendalikan uji. Menghitung berapa kali ringtone diputar dan notifikasi
/// lokal ditampilkan.
class RingtoneProbePlatform extends FirebaseDriverPushPlatform {
  RingtoneProbePlatform._(this.ringtone, this.shown, bool foreground)
      : super(
          isForeground: () => foreground,
          playRingtone: (_) async {
            ringtone.add(1);
            return true;
          },
          showLocal: (id, title, body, details) async => shown.add(details),
        );

  factory RingtoneProbePlatform({bool foreground = true}) =>
      RingtoneProbePlatform._(<int>[], <NotificationDetails>[], foreground);

  final List<int> ringtone;
  final List<NotificationDetails> shown;
  final fcm = StreamController<DriverPushMessage>.broadcast();

  @override
  Future<String?> obtainToken() async => 'tok';
  @override
  Stream<String> get tokenRefreshes => const Stream.empty();
  @override
  Stream<DriverPushMessage> get foregroundMessages => fcm.stream;
  @override
  Stream<DriverPushMessage> get openedMessages => const Stream.empty();
  @override
  Future<void> deleteToken() async {}
}

class FakePushPlatform implements DriverPushPlatform {
  FakePushPlatform({required this.token});
  final String? token;
  bool deleted = false;
  final foreground = StreamController<DriverPushMessage>.broadcast();
  final List<DriverPushMessage> foregroundAlerts = [];

  @override
  Future<String?> obtainToken() async => token;
  @override
  Stream<String> get tokenRefreshes => const Stream.empty();
  @override
  Stream<DriverPushMessage> get foregroundMessages => foreground.stream;
  final opened = StreamController<DriverPushMessage>.broadcast();
  @override
  Stream<DriverPushMessage> get openedMessages => opened.stream;
  @override
  Future<void> deleteToken() async => deleted = true;
  @override
  Future<void> showForegroundAlert(DriverPushMessage message) async =>
      foregroundAlerts.add(message);
}
