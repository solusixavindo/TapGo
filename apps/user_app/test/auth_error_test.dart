import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

DioException serverError(int status,
    {String? code, String message = 'raw english message'}) {
  final request = RequestOptions(path: '/auth/login');
  return DioException(
    requestOptions: request,
    type: DioExceptionType.badResponse,
    response: Response<Map<String, dynamic>>(
      requestOptions: request,
      statusCode: status,
      data: {
        'success': false,
        if (code != null) 'code': code,
        'message': message
      },
    ),
  );
}

Future<void> openAuth(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2200);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 5200));
  await tester.pumpAndSettle();
}

Future<void> login(WidgetTester tester) async {
  final fields = find.byType(TextFormField);
  await tester.enterText(fields.at(0), '081234567890');
  await tester.enterText(fields.at(1), 'rahasia-uji');
  await tester.tap(find.text('Login').last);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  group('pemetaan pesan error masuk/daftar', () {
    test('kode dikenal → kalimat Indonesia yang bisa ditindaklanjuti', () {
      expect(
          tapGoAuthErrorMessage(serverError(401, code: 'INVALID_CREDENTIALS'),
              isRegister: false),
          'Nomor HP atau password salah.');
      expect(
          tapGoAuthErrorMessage(
              serverError(409, code: 'PHONE_ALREADY_REGISTERED'),
              isRegister: true),
          'Nomor HP sudah terdaftar. Silakan pilih Login.');
      expect(
          tapGoAuthErrorMessage(serverError(403, code: 'ACCOUNT_INACTIVE'),
              isRegister: false),
          'Akun ini tidak aktif. Hubungi bantuan TapGo.');
      expect(
          tapGoAuthErrorMessage(serverError(426, code: 'APP_UPDATE_REQUIRED'),
              isRegister: false),
          contains('perbarui TapGo dari Google Play'));
    });

    test(
        'pesan mentah server berbahasa Inggris tidak pernah sampai ke pengguna',
        () {
      for (final error in [
        serverError(400,
            code: 'VALIDATION_ERROR', message: 'Request validation failed'),
        serverError(500,
            code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected server error'),
        serverError(429, message: 'Too many requests'),
        serverError(418, message: 'I am a teapot'),
      ]) {
        for (final isRegister in [true, false]) {
          final message = tapGoAuthErrorMessage(error, isRegister: isRegister);
          expect(message, isNot(contains('validation')));
          expect(message, isNot(contains('Unexpected')));
          expect(message, isNot(contains('Too many')));
          expect(message, isNot(contains('teapot')));
        }
      }
      expect(tapGoAuthErrorMessage(serverError(429), isRegister: false),
          contains('Terlalu banyak percobaan'));
      expect(tapGoAuthErrorMessage(serverError(503), isRegister: false),
          contains('sedang bermasalah'));
    });

    test('jaringan putus dan HTML dari proxy dipetakan ke pesan jaringan/umum',
        () {
      final offline = DioException(
        requestOptions: RequestOptions(path: '/auth/login'),
        type: DioExceptionType.connectionError,
      );
      expect(tapGoAuthErrorMessage(offline, isRegister: false),
          contains('belum dapat dihubungi'));
      final html = DioException(
        requestOptions: RequestOptions(path: '/auth/login'),
        type: DioExceptionType.badResponse,
        response: Response<String>(
          requestOptions: RequestOptions(path: '/auth/login'),
          statusCode: 502,
          data: '<html>502 Bad Gateway</html>',
        ),
      );
      expect(tapGoAuthErrorMessage(html, isRegister: false),
          contains('sedang bermasalah'));
    });
  });

  group('layar masuk terhadap server palsu', () {
    testWidgets(
        'password salah: pesan jelas, satu permintaan, header kontrak terkirim',
        (tester) async {
      final api = FakeApi({
        'POST /auth/login': (_) => FakeReply.error(
            401, 'INVALID_CREDENTIALS', 'Invalid phone or password'),
      });
      tapGoSetHttpAdapterForTests(api);
      await openAuth(tester);
      await login(tester);

      expect(find.text('Nomor HP atau password salah.'), findsOneWidget);
      expect(find.textContaining('Invalid phone'), findsNothing);
      final call = api.callsTo('POST /auth/login').single;
      // Kontrak dengan server: gerbang klien lama membaca header ini.
      expect(call.headers['X-TapGo-Distribution'], 'play');
      expect(call.headers['X-TapGo-App-Version'], isNot('1.0.3+4'));
    });

    testWidgets(
        'server menolak build lama (426): pengguna diarahkan memperbarui',
        (tester) async {
      final api = FakeApi({
        'POST /auth/login': (_) =>
            FakeReply.error(426, 'APP_UPDATE_REQUIRED', 'x'),
      });
      tapGoSetHttpAdapterForTests(api);
      await openAuth(tester);
      await login(tester);
      expect(find.textContaining('perbarui TapGo dari Google Play'),
          findsOneWidget);
    });

    testWidgets(
        'server error 500 berbahasa Inggris tampil sebagai kalimat Indonesia',
        (tester) async {
      final api = FakeApi({
        'POST /auth/login': (_) => FakeReply.error(
            500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error'),
      });
      tapGoSetHttpAdapterForTests(api);
      await openAuth(tester);
      await login(tester);
      expect(find.textContaining('Unexpected'), findsNothing);
      expect(find.textContaining('Server TapGo sedang bermasalah'),
          findsOneWidget);
    });
  });
}
