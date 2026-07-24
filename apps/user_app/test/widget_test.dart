import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

void main() {
  DemoClientSession authTestSession() {
    return DemoClientSession.initial().copyWith(
      userId: 'user-auth-test',
      userName: 'Member TapGo',
      phone: '+6281234567890',
      accessToken: 'access-token-test',
      refreshToken: 'refresh-token-test',
      isDemoMode: false,
    );
  }

  setUp(() {
    tapGoSupportTicketsLoaderForTests = null;
    tapGoSupportTicketDetailLoaderForTests = null;
    tapGoCreateSupportTicketForTests = null;
  });

  Future<void> openAuth(WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    tapGoEnablePaymentSimulatorForTests = false;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 5200));
    await tester.pump();
    await tester.pumpAndSettle();
  }

  Future<void> openDashboard(
    WidgetTester tester, {
    bool enablePaymentSimulator = false,
  }) async {
    tapGoDisablePersistenceForTests = true;
    tapGoEnablePaymentSimulatorForTests = enablePaymentSimulator;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: TapGoDashboard(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('all 3d service icon assets resolve locally',
      (WidgetTester tester) async {
    TestWidgetsFlutterBinding.ensureInitialized();
    const serviceIconAssets = [
      'assets/illustrations/services/tg-home.svg',
      'assets/illustrations/services/tg-wallet.svg',
      'assets/illustrations/services/tg-top-up.svg',
      'assets/illustrations/services/tg-upgrade.svg',
      'assets/illustrations/services/tg-referral.svg',
      'assets/illustrations/services/tg-membership.svg',
      'assets/illustrations/services/tg-reward.svg',
      'assets/illustrations/services/tg-bonus.svg',
      'assets/illustrations/services/tg-commission.svg',
      'assets/illustrations/services/tg-cashback.svg',
      'assets/illustrations/services/tg-ppob.svg',
      'assets/illustrations/services/tg-pulsa.svg',
      'assets/illustrations/services/tg-bpjs.svg',
      'assets/illustrations/services/tg-tagihan.svg',
      'assets/illustrations/services/tg-merchant.svg',
      'assets/illustrations/services/tg-marketplace.svg',
      'assets/illustrations/services/tg-jasa.svg',
      'assets/illustrations/services/tg-ojek-motor.svg',
      'assets/illustrations/services/tg-ojek-mobil.svg',
      'assets/illustrations/services/tg-activity.svg',
      'assets/illustrations/services/tg-kelas-online.svg',
      'assets/illustrations/services/tg-webinar.svg',
      'assets/illustrations/services/tg-event.svg',
      'assets/illustrations/services/tg-notification.svg',
      'assets/illustrations/services/tg-chat.svg',
      'assets/illustrations/services/tg-support.svg',
      'assets/illustrations/services/tg-profile.svg',
    ];
    final svgBodies = <String>{};

    for (final asset in serviceIconAssets) {
      final svg = await rootBundle.loadString(asset);
      expect(svg, contains('<svg'));
      expect(svg, contains('viewBox="0 0 96 96"'));
      expect(svg, isNot(contains('rect x="0"')));
      svgBodies.add(svg);
    }
    expect(svgBodies.length, serviceIconAssets.length);
  });

  testWidgets('service grid exposes only Play-safe core services',
      (WidgetTester tester) async {
    final semantics = tester.ensureSemantics();
    try {
      await openDashboard(tester);

      expect(find.text('Segera'), findsNothing);
      expect(find.text('Kartu Anggota'), findsWidgets);
      expect(find.text('Referral'), findsNothing);
      expect(find.text('Tiket Bantuan'), findsWidgets);
      expect(find.text('Profil'), findsWidgets);
      expect(find.bySemanticsLabel('Buka layanan TapGo Ride'), findsNothing);
      expect(find.bySemanticsLabel('Buka layanan TapGo Mart'), findsNothing);
      expect(find.bySemanticsLabel('Buka layanan PPOB'), findsNothing);
      expect(
          find.bySemanticsLabel('Buka layanan Kartu Anggota'), findsOneWidget);
    } finally {
      semantics.dispose();
    }
  });

  test('Play service boundaries hide placeholder and referral destinations',
      () {
    final playLabels =
        tapGoSuperMenuLabelsForDistributionForTests(TapGoDistributionMode.play);
    final directLabels = tapGoSuperMenuLabelsForDistributionForTests(
        TapGoDistributionMode.direct);

    expect(playLabels, contains('Kartu Anggota'));
    expect(playLabels, contains('Tiket Bantuan'));
    expect(playLabels, isNot(contains('Referral')));
    expect(playLabels, isNot(contains('TapGo Ride')));
    expect(playLabels, isNot(contains('TapGo Car')));
    expect(playLabels, isNot(contains('TapGo Food')));
    expect(playLabels, isNot(contains('TapGo Mart')));
    expect(playLabels, isNot(contains('Pulsa')));
    expect(playLabels, isNot(contains('PPOB')));

    expect(directLabels, contains('Referral'));
    expect(directLabels, contains('TapGo Ride'));
    expect(directLabels, contains('PPOB'));

    expect(tapGoSuperMenuDestinationForLabelForTests('PPOB'), isNull);
    expect(tapGoSuperMenuDestinationForLabelForTests('Referral'), isNull);
  });

  test('login backend succeeds and persistence succeeds', () async {
    final session = authTestSession();
    DemoClientSession? runtimeSession;
    var authenticated = false;
    var dashboardNavigationCount = 0;

    final activation = tapGoActivateAuthenticatedRuntimeSession(
      session: session,
      setSession: (value) => runtimeSession = value,
      setAuthenticated: (value) => authenticated = value,
      afterAuthenticated: () => dashboardNavigationCount++,
    );
    final persistence = await tapGoPersistAuthenticatedSessionBestEffort(
      session: session,
      steps: [
        TapGoSessionPersistStep(
            name: 'saveSession', persist: (_) async => true),
        TapGoSessionPersistStep(name: 'saveTokens', persist: (_) async => true),
      ],
    );

    expect(activation.authenticated, isTrue);
    expect(authenticated, isTrue);
    expect(runtimeSession, session);
    expect(dashboardNavigationCount, 1);
    expect(persistence.success, isTrue);
  });

  test('logout followed by relogin refreshes session and reopens dashboard',
      () async {
    final firstSession = authTestSession().copyWith(
      userId: 'first-session',
      accessToken: 'first-access-token',
      refreshToken: 'first-refresh-token',
    );
    final secondSession = authTestSession().copyWith(
      userId: 'second-session',
      accessToken: 'second-access-token',
      refreshToken: 'second-refresh-token',
    );
    DemoClientSession runtimeSession = DemoClientSession.initial();
    var authenticated = false;
    var dashboardNavigationCount = 0;

    tapGoActivateAuthenticatedRuntimeSession(
      session: firstSession,
      setSession: (value) => runtimeSession = value,
      setAuthenticated: (value) => authenticated = value,
      afterAuthenticated: () => dashboardNavigationCount++,
    );
    expect(authenticated, isTrue);
    expect(runtimeSession.userId, 'first-session');
    expect(dashboardNavigationCount, 1);

    runtimeSession = DemoClientSession.initial();
    authenticated = false;

    tapGoActivateAuthenticatedRuntimeSession(
      session: secondSession,
      setSession: (value) => runtimeSession = value,
      setAuthenticated: (value) => authenticated = value,
      afterAuthenticated: () => dashboardNavigationCount++,
    );

    expect(authenticated, isTrue);
    expect(runtimeSession.userId, 'second-session');
    expect(runtimeSession.accessToken, 'second-access-token');
    expect(dashboardNavigationCount, 2);
  });

  test('restart restore keeps the latest active login session fields', () {
    final session = authTestSession().copyWith(
      userId: 'restart-user',
      accessToken: 'restart-access-token',
      refreshToken: 'restart-refresh-token',
      userName: 'Member Restart',
      phone: '+628111222333',
    );

    final restored =
        tapGoSessionFromJsonForTests(tapGoSessionToJsonForTests(session));

    expect(restored.userId, 'restart-user');
    expect(restored.accessToken, 'restart-access-token');
    expect(restored.refreshToken, 'restart-refresh-token');
    expect(restored.userName, 'Member Restart');
    expect(restored.phone, '+628111222333');
    expect(restored.isDemoMode, isFalse);
  });

  test('login backend succeeds and persistence throws', () async {
    final session = authTestSession();
    var authenticated = false;

    tapGoActivateAuthenticatedRuntimeSession(
      session: session,
      setSession: (_) {},
      setAuthenticated: (value) => authenticated = value,
    );
    final persistence = await tapGoPersistAuthenticatedSessionBestEffort(
      session: session,
      steps: [
        TapGoSessionPersistStep(
          name: 'saveSession',
          persist: (_) {
            throw StateError('storage unavailable');
          },
        ),
      ],
    );

    expect(authenticated, isTrue);
    expect(persistence.success, isFalse);
    expect(persistence.failedSteps, ['saveSession']);
  });

  test('login backend succeeds and persistence times out', () async {
    final session = authTestSession();
    var authenticated = false;

    tapGoActivateAuthenticatedRuntimeSession(
      session: session,
      setSession: (_) {},
      setAuthenticated: (value) => authenticated = value,
    );
    final persistence = await tapGoPersistAuthenticatedSessionBestEffort(
      session: session,
      stepTimeout: const Duration(milliseconds: 10),
      steps: [
        TapGoSessionPersistStep(
          name: 'saveTokens',
          persist: (_) => Completer<bool>().future,
        ),
      ],
    );

    expect(authenticated, isTrue);
    expect(persistence.success, isFalse);
    expect(persistence.failedSteps, ['saveTokens']);
  });

  test('register remains authenticated when persistence fails', () async {
    final session = authTestSession().copyWith(userId: 'registered-user');
    var authenticated = false;

    tapGoActivateAuthenticatedRuntimeSession(
      session: session,
      setSession: (_) {},
      setAuthenticated: (value) => authenticated = value,
    );
    final persistence = await tapGoPersistAuthenticatedSessionBestEffort(
      session: session,
      steps: [
        TapGoSessionPersistStep(
          name: 'saveRegisteredUser',
          persist: (_) async => false,
        ),
      ],
    );

    expect(authenticated, isTrue);
    expect(persistence.success, isFalse);
    expect(persistence.failedSteps, ['saveRegisteredUser']);
  });

  test('referral claim failure does not invalidate registration', () async {
    final result = await tapGoClaimReferralBestEffort(
      referralCode: 'TAPG123456',
      claimReferral: (_) async => throw DioException(
        requestOptions: RequestOptions(path: '/referrals/claim'),
        message: 'network unavailable',
      ),
    );

    expect(result.success, isFalse);
    expect(result.warningMessage, isNotNull);
    expect(result.warningMessage, contains('Registrasi berhasil'));
  });

  test('single flight guard prevents duplicate form actions', () async {
    final guard = TapGoSingleFlightGuard();
    final completer = Completer<bool>();
    var runCount = 0;

    final first = guard.run(() async {
      runCount++;
      return completer.future;
    });
    final second = await guard.run(() async {
      runCount++;
      return true;
    });

    expect(second, isNull);
    expect(runCount, 1);
    expect(guard.isRunning, isTrue);

    completer.complete(true);
    expect(await first, isTrue);
    expect(guard.isRunning, isFalse);

    await expectLater(
      guard.run<bool>(() async {
        runCount++;
        throw StateError('network unavailable');
      }),
      throwsA(isA<StateError>()),
    );
    expect(guard.isRunning, isFalse);

    final retry = await guard.run(() async {
      runCount++;
      return true;
    });

    expect(retry, isTrue);
    expect(runCount, 3);
  });

  test('document upload only succeeds with a valid picked file path', () {
    expect(tapGoIsValidPickedDocumentPathForTests(null), isFalse);
    expect(tapGoIsValidPickedDocumentPathForTests(''), isFalse);
    expect(tapGoIsValidPickedDocumentPathForTests('   '), isFalse);
    expect(
      tapGoIsValidPickedDocumentPathForTests(' /tmp/tapgo-ktp.jpg '),
      isTrue,
    );
    expect(
      tapGoUploadSuccessLabelForTests(ImageSource.gallery),
      'Foto berhasil dipilih',
    );
    expect(
      tapGoUploadSuccessLabelForTests(ImageSource.camera),
      'Foto berhasil diambil',
    );
    expect(tapGoDocumentUploadFailureMessage, isNot(contains('Exception')));
    expect(tapGoDocumentUploadFailureMessage, isNot(contains('/tmp')));
    expect(tapGoDocumentUploadFailureMessage, isNot(contains('channel-error')));
  });

  test('Indonesian phone input accepts supported formats safely', () {
    expect(tapGoPhoneValidatorMessage('0812 3456-7890'), isNull);
    expect(tapGoPhoneValidatorMessage('6281234567890'), isNull);
    expect(tapGoPhoneValidatorMessage('+6281234567890'), isNull);
    expect(
      tapGoSanitizePhoneInput('+62 812-3456-7890'),
      '+6281234567890',
    );
    expect(tapGoSanitizePhoneInput('6281234567890'), '6281234567890');
    expect(tapGoPhoneValidatorMessage('12345'), 'Nomor HP tidak valid');
    expect(
      tapGoPhoneValidatorMessage(''),
      'Nomor HP wajib diisi',
    );
  });

  test('NIK input keeps digits only, caps length, and preserves leading zero',
      () {
    final formatted = _applyFormatters(
      tapGoNikInputFormatters,
      '00A1234567890123456789',
    );

    expect(formatted, '0012345678901234');
    expect(formatted.length, 16);
    expect(tapGoNikValidatorMessage('0012345678901234'), isNull);
    expect(
      tapGoNikValidatorMessage('001234567890123'),
      'NIK harus terdiri dari 16 digit.',
    );
  });

  test('bank account input keeps digit string and leading zero intact', () {
    final formatted = _applyFormatters(
      tapGoDigitsOnlyInputFormatters,
      '0012 34-567A',
    );

    expect(formatted, '001234567');
    expect(tapGoDigitsOnly(formatted), '001234567');
    expect(tapGoBankAccountValidatorMessage('001234'), isNull);
    expect(
      tapGoBankAccountValidatorMessage('00123'),
      'Nomor rekening tidak valid',
    );
  });

  test('Rupiah formatter separates display from canonical integer value', () {
    expect(_applyFormatters(tapGoRupiahInputFormatters, '1000'), '1.000');
    expect(
      _applyFormatters(tapGoRupiahInputFormatters, '150000'),
      '150.000',
    );
    expect(
      _applyFormatters(tapGoRupiahInputFormatters, 'Rp150.000'),
      '150.000',
    );
    expect(tapGoCanonicalRupiahValue('150.000'), 150000);
    expect(tapGoCanonicalRupiahValue(''), 0);
    expect(tapGoCanonicalRupiahValue('0'), 0);
    expect(tapGoFormatRupiahInput('150.000'), '150.000');
    expect(tapGoFormatRupiahInput('0'), '0');
  });

  test('Rupiah formatter keeps cursor near edited digit position', () {
    final formatter = TapGoRupiahInputFormatter();
    final result = formatter.formatEditUpdate(
      const TextEditingValue(
        text: '12.345',
        selection: TextSelection.collapsed(offset: 2),
      ),
      const TextEditingValue(
        text: '120.345',
        selection: TextSelection.collapsed(offset: 3),
      ),
    );

    expect(result.text, '120.345');
    expect(result.selection.extentOffset, 3);
    expect(tapGoRupiahSelectionOffset('150.000', 3), 3);
  });

  testWidgets('startup restore without valid token safely returns login',
      (WidgetTester tester) async {
    await openAuth(tester);

    expect(find.text('TapGo Lion'), findsOneWidget);
    expect(
        find.text('Masuk untuk lanjut ke dashboard layanan.'), findsOneWidget);
    expect(find.text('TapGoPay'), findsNothing);
  });

  testWidgets('auth screen does not bypass backend login',
      (WidgetTester tester) async {
    await openAuth(tester);

    expect(find.text('TapGo Lion'), findsOneWidget);
    expect(find.text('Lanjutkan pratinjau aplikasi'), findsNothing);

    await tester.tap(find.text('Login').last);
    await tester.pump();

    expect(find.text('TapGoPay'), findsNothing);
  });

  testWidgets('staging register requires real data and hides preview bypass',
      (WidgetTester tester) async {
    await openAuth(tester);

    await tester.tap(find.text('Register'));
    await tester.pumpAndSettle();

    expect(find.text('Lanjutkan pratinjau aplikasi'), findsNothing);

    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '');
    await tester.enterText(fields.at(1), '');
    await tester.enterText(fields.at(2), '');
    await tester.ensureVisible(find.text('Register & Masuk'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Register & Masuk'));
    await tester.pumpAndSettle();

    expect(find.text('Nama wajib diisi'), findsOneWidget);
    expect(find.text('Nomor HP wajib diisi'), findsOneWidget);
    expect(find.text('Password wajib diisi'), findsOneWidget);
    expect(find.text('TapGoPay'), findsNothing);

    await tester.enterText(fields.at(0), 'UAT Member A');
    await tester.enterText(fields.at(1), '12345');
    await tester.enterText(fields.at(2), 'uat12345');
    await tester.ensureVisible(find.text('Register & Masuk'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Register & Masuk'));
    await tester.pumpAndSettle();

    expect(find.text('Nomor HP tidak valid'), findsOneWidget);
    expect(find.text('TapGoPay'), findsNothing);
  });

  testWidgets('dashboard keeps Basic status and hides paid membership purchase',
      (WidgetTester tester) async {
    await openDashboard(tester);

    expect(find.text('Paket aktif: Basic'), findsOneWidget);
    expect(find.text('Marketing Plan'), findsNothing);
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: MembershipPackagesScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Kartu Anggota'), findsOneWidget);
    expect(find.text('TapGo Member Card'), findsOneWidget);
    expect(find.text('Basic'), findsOneWidget);
    expect(find.text('Gratis'), findsNothing);
    expect(find.text('Silver'), findsNothing);
    expect(find.text('Gold'), findsNothing);
    expect(find.text('Platinum'), findsNothing);
    expect(find.textContaining('Rp500.000'), findsNothing);
    expect(find.textContaining('Rp3.000.000'), findsNothing);
    expect(find.textContaining('Rp5.500.000'), findsNothing);
    expect(find.text('Daftar'), findsNothing);

    expect(find.text('Form Membership'), findsNothing);
    expect(find.text('Paket Silver'), findsNothing);
    expect(find.text('Bayar Sekarang'), findsNothing);
  });

  test('distribution mode defaults and fails closed to Play', () {
    expect(tapGoDistributionModeFromValue(null), TapGoDistributionMode.play);
    expect(tapGoDistributionModeFromValue(''), TapGoDistributionMode.play);
    expect(tapGoDistributionModeFromValue('play'), TapGoDistributionMode.play);
    expect(tapGoDistributionModeFromValue('unexpected'),
        TapGoDistributionMode.play);
    expect(
        tapGoDistributionModeFromValue('direct'), TapGoDistributionMode.direct);
    expect(tapGoIsPlayDistribution, isTrue);
  });

  test('payment provider copy follows gateway with neutral fallback', () {
    expect(
      tapGoPaymentStatusInstructionForTests('DOKU'),
      'Selesaikan pembayaran di halaman DOKU, lalu cek status pembayaran Anda.',
    );
    expect(
      tapGoPaymentStatusInstructionForTests('MIDTRANS'),
      'Selesaikan pembayaran di halaman Midtrans, lalu cek status pembayaran Anda.',
    );
    expect(
      tapGoPaymentStatusInstructionForTests(null),
      'Selesaikan pembayaran di halaman pembayaran, lalu cek status pembayaran Anda.',
    );
    expect(
      tapGoPaymentStatusInstructionForTests('unknown'),
      isNot(contains('DOKU')),
    );
    expect(tapGoPaymentUrlDialogTitleForTests('DOKU'), 'Link Pembayaran DOKU');
    expect(
      tapGoPaymentUrlDialogTitleForTests('MIDTRANS'),
      'Link Pembayaran Midtrans',
    );
    expect(tapGoPaymentUrlDialogTitleForTests(null), 'Link Pembayaran');
    expect(tapGoCheckoutLaunchModeForTests(), LaunchMode.externalApplication);
  });

  testWidgets('bottom navigation tabs and super menu are clickable',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Aktivitas'));
    await tester.pumpAndSettle();
    expect(find.text('Data belum tersedia'), findsOneWidget);

    await tester.tap(find.text('Chat'));
    await tester.pumpAndSettle();
    expect(find.text('Belum ada pesan'), findsOneWidget);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();
    expect(find.text('Kartu Anggota'), findsOneWidget);
    expect(find.text('Salin link referral'), findsNothing);
    expect(find.text('Jaringan Saya'), findsNothing);

    await tester.tap(find.byIcon(Icons.apps_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Super Menu'), findsOneWidget);
    expect(find.text('TapGo Ride'), findsNothing);
    expect(find.text('PPOB'), findsNothing);
    expect(find.text('Referral'), findsNothing);
    expect(find.text('Kartu Anggota'), findsOneWidget);
    expect(find.text('Reward'), findsNothing);
    expect(find.text('BPJS'), findsNothing);
    expect(find.text('Tiket Bantuan'), findsOneWidget);
  });

  testWidgets('Play dashboard action tiles navigate without pointer blockers',
      (WidgetTester tester) async {
    await openDashboard(tester);

    final memberCardTile = find.bySemanticsLabel('Buka layanan Kartu Anggota');
    await tester.ensureVisible(memberCardTile);
    await tester.tap(memberCardTile);
    await tester.pumpAndSettle();
    expect(find.text('TapGo Member Card'), findsOneWidget);
    Navigator.of(tester.element(find.text('TapGo Member Card'))).pop();
    await tester.pumpAndSettle();

    final profileTile = find.bySemanticsLabel('Buka layanan Profil');
    await tester.ensureVisible(profileTile);
    await tester.tap(profileTile);
    await tester.pumpAndSettle();
    expect(find.text('Kartu Anggota'), findsWidgets);
    expect(find.text('Kebijakan Privasi'), findsOneWidget);
    Navigator.of(tester.element(find.text('Kebijakan Privasi'))).pop();
    await tester.pumpAndSettle();

    final supportTile = find.bySemanticsLabel('Buka layanan Tiket Bantuan');
    await tester.ensureVisible(supportTile);
    await tester.tap(supportTile);
    await tester.pumpAndSettle();
    expect(find.text('Bantuan TapGo'), findsOneWidget);
    Navigator.of(tester.element(find.text('Bantuan TapGo'))).pop();
    await tester.pumpAndSettle();

    final deleteTile = find.bySemanticsLabel('Buka layanan Hapus Akun');
    await tester.ensureVisible(deleteTile);
    await tester.tap(deleteTile);
    await tester.pumpAndSettle();
    expect(find.text('Ajukan Penghapusan Akun'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Play account legal and deletion actions remain reachable',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Kebijakan Privasi'));
    await tester.tap(find.text('Kebijakan Privasi'));
    await tester.pumpAndSettle();
    expect(find.text('Kebijakan Privasi'), findsWidgets);
    expect(find.textContaining('TapGo'), findsWidgets);
    Navigator.of(tester.element(find.text('Kebijakan Privasi').first)).pop();
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Hapus Akun'));
    await tester.tap(find.text('Hapus Akun'));
    await tester.pumpAndSettle();
    expect(find.text('Ajukan Penghapusan Akun'), findsOneWidget);
  });

  testWidgets('dashboard remains usable when reduced motion is enabled',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    tapGoEnablePaymentSimulatorForTests = false;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: true),
            child: TapGoDashboard(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('TapGoPay'), findsNothing);
    expect(find.byIcon(Icons.apps_rounded), findsOneWidget);
    expect(find.text('Membership'), findsWidgets);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Kartu Anggota'), findsOneWidget);
    expect(find.text('Salin link referral'), findsNothing);
  });

  testWidgets('Play mode blocks referral tree from account navigation',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Jaringan Saya'), findsNothing);
    expect(find.text('Jaringan Referral'), findsNothing);
    expect(find.text('Kode Referral'), findsNothing);
  });

  testWidgets('user account does not expose admin dashboard',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Admin Console'), findsNothing);
    expect(find.text('Admin Dashboard'), findsNothing);
    expect(find.text('Super Admin Dashboard'), findsNothing);
  });

  testWidgets('Play account menu hides bank and cash surfaces',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Rekening Bank'), findsNothing);
    expect(find.text('Wallet & Withdraw'), findsNothing);
    expect(find.text('Riwayat Komisi'), findsNothing);
    expect(find.text('TapGoPay'), findsNothing);
  });

  testWidgets('bank account picker still opens directly without assertion',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    tapGoEnablePaymentSimulatorForTests = false;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: BankAccountScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Rekening Bank'));

    expect(find.text('Rekening Bank'), findsWidgets);
    expect(find.text('Nama bank'), findsOneWidget);

    final bankFieldCenter = tester.getCenter(find.text('Pilih bank').last);
    await tester.tapAt(Offset(120, bankFieldCenter.dy));
    await tester.pumpAndSettle();
    expect(find.text('Pilih Bank'), findsOneWidget);

    await tester.tap(find.text('Bank Mandiri'));
    await tester.pumpAndSettle();
    await tester.pump();

    expect(find.text('Bank Mandiri'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('account deletion request requires confirmation',
      (WidgetTester tester) async {
    await openDashboard(tester);

    await tester.tap(find.text('Akun'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Hapus Akun'));
    await tester.tap(find.text('Hapus Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Hapus Akun'), findsWidgets);
    expect(find.text('Ajukan Penghapusan Akun'), findsOneWidget);
    expect(find.text('Konfirmasi hapus akun'), findsNothing);

    await tester.enterText(
      find.byType(TextField).last,
      'Permintaan review Google Play',
    );
    await tester.tap(find.text('Ajukan Penghapusan Akun'));
    await tester.pumpAndSettle();

    expect(find.text('Konfirmasi hapus akun'), findsOneWidget);
    expect(find.text('Kirim Pengajuan'), findsOneWidget);

    await tester.tap(find.text('Batal'));
    await tester.pumpAndSettle();
    expect(find.text('Konfirmasi hapus akun'), findsNothing);
    expect(find.text('Pengajuan hapus akun berhasil dikirim.'), findsNothing);
  });

  testWidgets('Play membership flow does not open external checkout',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    tapGoEnablePaymentSimulatorForTests = true;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: MembershipPackagesScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('TapGo Member Card'), findsOneWidget);
    expect(find.text('Silver'), findsNothing);
    expect(find.text('Gold'), findsNothing);
    expect(find.text('Platinum'), findsNothing);
    expect(find.text('Form Membership'), findsNothing);
    expect(find.text('Menunggu Pembayaran'), findsNothing);
    expect(find.text('Bayar Sekarang'), findsNothing);
    expect(find.text('Pembayaran'), findsNothing);
    expect(find.text('Pendaftaran Berhasil'), findsNothing);
  });

  testWidgets('Basic member card exposes only safe identity fields',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: BasicMemberCardScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('TapGo Member Card'), findsOneWidget);
    expect(find.text('TGM-TESTCARD'), findsOneWidget);
    expect(find.text('Aktif'), findsOneWidget);
    expect(find.text('NIK'), findsNothing);
    expect(find.text('Nomor HP'), findsNothing);
    expect(find.text('Rekening'), findsNothing);
    expect(find.text('Wallet'), findsNothing);
    expect(find.text('Saldo'), findsNothing);
  });

  testWidgets('support page opens with authenticated ticket empty state',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: ContactUsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Bantuan TapGo'), findsOneWidget);
    expect(find.text('Judul bantuan'), findsOneWidget);
    expect(find.text('Pesan bantuan'), findsOneWidget);
    expect(find.text('Belum ada tiket bantuan'), findsOneWidget);
  });

  testWidgets('support ticket can be created, listed, and opened',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = false;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    final tickets = <Map<String, dynamic>>[];
    tapGoSupportTicketsLoaderForTests = () async => tickets;
    tapGoCreateSupportTicketForTests = ({
      required String category,
      required String subject,
      required String message,
    }) async {
      final ticket = {
        'id': 'ticket-1',
        'reference': 'SUP-0001',
        'category': category,
        'subject': subject.trim(),
        'status': 'OPEN',
        'messages': [
          {
            'id': 'message-1',
            'authorRole': 'USER',
            'body': message.trim(),
          },
        ],
      };
      tickets.add(ticket);
      return ticket;
    };
    tapGoSupportTicketDetailLoaderForTests = (ticketId) async =>
        tickets.singleWhere((ticket) => ticket['id'] == ticketId);

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: ContactUsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'Bantuan akun');
    await tester.enterText(
      find.byType(TextField).at(1),
      'Saya membutuhkan bantuan untuk akun Basic.',
    );
    await tester.tap(find.text('Kirim Pesan'));
    await tester.pumpAndSettle();

    expect(find.text('Bantuan akun'), findsOneWidget);
    expect(find.textContaining('SUP-0001'), findsOneWidget);

    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Bantuan akun'));
    await tester.tap(find.text('Bantuan akun'));
    await tester.pumpAndSettle();

    expect(find.text('Detail Tiket'), findsOneWidget);
    expect(find.textContaining('Terbuka'), findsOneWidget);
    expect(find.text('Anda'), findsOneWidget);
    expect(find.text('Saya membutuhkan bantuan untuk akun Basic.'),
        findsOneWidget);
    expect(find.textContaining('Exception'), findsNothing);
  });

  testWidgets('support errors use friendly copy and avoid raw exceptions',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = false;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();
    tapGoSupportTicketsLoaderForTests = () async => const [];
    tapGoCreateSupportTicketForTests = ({
      required String category,
      required String subject,
      required String message,
    }) async {
      throw DioException(
        requestOptions: RequestOptions(path: '/support/tickets'),
        message: 'SocketException: Connection failed',
      );
    };

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: ContactUsScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'Bantuan akun');
    await tester.enterText(
      find.byType(TextField).at(1),
      'Saya membutuhkan bantuan untuk akun Basic.',
    );
    await tester.tap(find.text('Kirim Pesan'));
    await tester.pumpAndSettle();

    expect(find.text('Tiket bantuan belum dapat dibuat. Silakan coba lagi.'),
        findsOneWidget);
    expect(find.textContaining('SocketException'), findsNothing);
  });

  testWidgets('support form stays usable on narrow screens with keyboard',
      (WidgetTester tester) async {
    tapGoDisablePersistenceForTests = true;
    ImagePickerPlatform.instance = _FakeImagePickerPlatform();

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: Size(320, 640),
              viewInsets: EdgeInsets.only(bottom: 280),
            ),
            child: ContactUsScreen(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).at(0), 'Bantuan akun');
    await tester.enterText(
      find.byType(TextField).at(1),
      'Saya membutuhkan bantuan untuk akun Basic.',
    );
    await tester.ensureVisible(find.text('Kirim Pesan'));

    expect(find.text('Kirim Pesan'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

String _applyFormatters(List<TextInputFormatter> formatters, String value) {
  var oldValue = const TextEditingValue();
  var newValue = TextEditingValue(
    text: value,
    selection: TextSelection.collapsed(offset: value.length),
  );
  for (final formatter in formatters) {
    final result = formatter.formatEditUpdate(oldValue, newValue);
    oldValue = result;
    newValue = result;
  }
  return newValue.text;
}

class _FakeImagePickerPlatform extends ImagePickerPlatform {
  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async {
    return XFile(
      '/tmp/tapgo-${source.name}.jpg',
      name: source == ImageSource.gallery
          ? 'tapgo-galeri-test.jpg'
          : 'tapgo-kamera-test.jpg',
    );
  }
}
