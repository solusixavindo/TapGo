import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Test UI ubah password (Pengaturan → Ubah password).
///
/// Test ini tidak memanggil backend. Batas jaringan diganti hook
/// [tapGoChangePasswordSubmitterForTests]. Yang diuji adalah perilaku layar:
/// validasi lokal, kunci single-flight, pemetaan pesan error yang ramah
/// pengguna, dan alur wajib masuk ulang setelah sukses — backend mencabut
/// semua sesi saat password diganti, sehingga aplikasi tidak boleh
/// mempertahankan sesi lama.

Widget wrap(Widget child) {
  return ProviderScope(child: MaterialApp(home: child));
}

DioException dioError({int statusCode = 500, String? code}) {
  final request = RequestOptions(path: '/auth/change-password');
  return DioException(
    requestOptions: request,
    type: DioExceptionType.badResponse,
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
    tapGoChangePasswordSubmitterForTests = null;
  });

  tearDown(() {
    tapGoChangePasswordSubmitterForTests = null;
    tapGoDisablePersistenceForTests = false;
  });

  group('pesan error ramah pengguna', () {
    test('password lama salah dipetakan ke pesan khusus', () {
      expect(
        tapGoChangePasswordErrorMessage(
          dioError(statusCode: 401, code: 'INVALID_CREDENTIALS'),
        ),
        'Password saat ini salah.',
      );
    });

    test('password tidak berubah dipetakan ke pesan khusus', () {
      expect(
        tapGoChangePasswordErrorMessage(
          dioError(statusCode: 400, code: 'PASSWORD_UNCHANGED'),
        ),
        'Password baru harus berbeda dari password saat ini.',
      );
    });

    test('tidak pernah menampilkan exception mentah', () {
      final message = tapGoChangePasswordErrorMessage(
        StateError('boom internal'),
      );
      expect(message, 'Gagal mengubah password. Silakan coba lagi.');
      expect(message.contains('boom internal'), isFalse);
      expect(message.contains('StateError'), isFalse);
    });
  });

  group('ChangePasswordScreen', () {
    testWidgets('validasi lokal menolak isian tanpa memanggil jaringan', (
      tester,
    ) async {
      var submitCalls = 0;
      tapGoChangePasswordSubmitterForTests = ({
        required String currentPassword,
        required String newPassword,
      }) async {
        submitCalls++;
      };
      await tester.pumpWidget(wrap(const ChangePasswordScreen()));

      await tester.tap(find.text('Simpan password'));
      await tester.pump();
      expect(find.text('Isi password saat ini dulu.'), findsOneWidget);

      await tester.enterText(
        find.widgetWithText(TextField, 'Password saat ini'),
        'Lama123',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password baru'),
        'abc',
      );
      await tester.tap(find.text('Simpan password'));
      await tester.pump();
      expect(find.text('Password baru minimal 6 karakter.'), findsOneWidget);

      await tester.enterText(
        find.widgetWithText(TextField, 'Password baru'),
        'Lama123',
      );
      await tester.tap(find.text('Simpan password'));
      await tester.pump();
      expect(
        find.text('Password baru harus berbeda dari password saat ini.'),
        findsOneWidget,
      );

      await tester.enterText(
        find.widgetWithText(TextField, 'Password baru'),
        'Baru12345',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Konfirmasi password baru'),
        'Baru12346',
      );
      await tester.tap(find.text('Simpan password'));
      await tester.pump();
      expect(
        find.text('Konfirmasi password baru belum sama.'),
        findsOneWidget,
      );

      // Seluruh penolakan di atas murni lokal: jaringan tidak pernah disentuh.
      expect(submitCalls, 0);
    });

    testWidgets('sukses menampilkan dialog lalu kembali ke layar masuk', (
      tester,
    ) async {
      String? gotCurrent;
      String? gotNew;
      tapGoChangePasswordSubmitterForTests = ({
        required String currentPassword,
        required String newPassword,
      }) async {
        gotCurrent = currentPassword;
        gotNew = newPassword;
      };
      await tester.pumpWidget(wrap(const ChangePasswordScreen()));

      await tester.enterText(
        find.widgetWithText(TextField, 'Password saat ini'),
        'Lama123',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password baru'),
        'Baru12345',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Konfirmasi password baru'),
        'Baru12345',
      );
      await tester.tap(find.text('Simpan password'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(gotCurrent, 'Lama123');
      expect(gotNew, 'Baru12345');
      expect(find.text('Password berhasil diubah'), findsOneWidget);

      await tester.tap(find.text('Masuk kembali'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 800));

      // Backend sudah mencabut semua sesi: aplikasi wajib kembali ke layar
      // masuk, bukan mempertahankan sesi lama yang sudah tidak berlaku.
      expect(find.byType(AuthScreen), findsOneWidget);
      expect(find.byType(ChangePasswordScreen), findsNothing);
    });

    testWidgets('kegagalan menampilkan pesan dan tetap di layar', (
      tester,
    ) async {
      tapGoChangePasswordSubmitterForTests = ({
        required String currentPassword,
        required String newPassword,
      }) async {
        throw dioError(statusCode: 401, code: 'INVALID_CREDENTIALS');
      };
      await tester.pumpWidget(wrap(const ChangePasswordScreen()));

      await tester.enterText(
        find.widgetWithText(TextField, 'Password saat ini'),
        'Salah123',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password baru'),
        'Baru12345',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Konfirmasi password baru'),
        'Baru12345',
      );
      await tester.tap(find.text('Simpan password'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Password saat ini salah.'), findsOneWidget);
      expect(find.byType(ChangePasswordScreen), findsOneWidget);
      expect(find.byType(AuthScreen), findsNothing);
    });

    testWidgets('tap beruntun hanya mengirim satu permintaan', (tester) async {
      var submitCalls = 0;
      tapGoChangePasswordSubmitterForTests = ({
        required String currentPassword,
        required String newPassword,
      }) async {
        submitCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 300));
      };
      await tester.pumpWidget(wrap(const ChangePasswordScreen()));

      await tester.enterText(
        find.widgetWithText(TextField, 'Password saat ini'),
        'Lama123',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Password baru'),
        'Baru12345',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Konfirmasi password baru'),
        'Baru12345',
      );

      // Selama permintaan berjalan label tombol berganti indikator muat,
      // sehingga tap susulan dibidik lewat tipe tombol, bukan teks.
      final button = find.byType(FilledButton);
      await tester.tap(button);
      await tester.tap(button, warnIfMissed: false);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(button, warnIfMissed: false);
      await tester.pump(const Duration(milliseconds: 500));

      expect(submitCalls, 1);
    });
  });
}
