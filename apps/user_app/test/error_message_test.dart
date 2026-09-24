import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/widgets/ppob_shared.dart';
import 'package:tapgo_user_app/main.dart';

/// Sekitar separuh pesan error backend berbahasa Inggris. Tidak satu pun boleh
/// sampai ke pengguna lewat jalur fallback mana pun.
DioException http(int status,
    {String? code, String message = 'English server message'}) {
  final request = RequestOptions(path: '/x');
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

void main() {
  group('tapGoGenericErrorMessage', () {
    const fallback = 'Aksi belum berhasil.';

    test('tidak pernah mengembalikan pesan mentah server', () {
      for (final error in [
        http(400, code: 'VALIDATION_ERROR'),
        http(404, code: 'CHAT_RIDE_NOT_FOUND', message: 'Ride not found'),
        http(409,
            code: 'EMAIL_ALREADY_IN_USE', message: 'Email already in use'),
        http(500,
            code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected server error'),
      ]) {
        expect(tapGoGenericErrorMessage(error, fallback: fallback),
            isNot(contains('English')));
        expect(tapGoGenericErrorMessage(error, fallback: fallback),
            isNot(contains('not found')));
        expect(tapGoGenericErrorMessage(error, fallback: fallback),
            isNot(contains('already')));
        expect(tapGoGenericErrorMessage(error, fallback: fallback),
            isNot(contains('Unexpected')));
      }
    });

    test('memetakan kelas kegagalan ke tindakan yang jelas', () {
      expect(
          tapGoGenericErrorMessage(http(400, code: 'VALIDATION_ERROR'),
              fallback: fallback),
          'Data belum sesuai. Periksa isian lalu coba lagi.');
      expect(tapGoGenericErrorMessage(http(401), fallback: fallback),
          'Sesi Anda berakhir. Silakan masuk kembali.');
      expect(
          tapGoGenericErrorMessage(http(426, code: 'APP_UPDATE_REQUIRED'),
              fallback: fallback),
          contains('perbarui TapGo dari Google Play'));
      expect(tapGoGenericErrorMessage(http(429), fallback: fallback),
          contains('Terlalu banyak'));
      expect(tapGoGenericErrorMessage(http(502), fallback: fallback),
          contains('sedang bermasalah'));
      expect(
          tapGoGenericErrorMessage(http(422, code: 'ANY_OTHER'),
              fallback: fallback),
          fallback);
      expect(
        tapGoGenericErrorMessage(
          DioException(
              requestOptions: RequestOptions(path: '/x'),
              type: DioExceptionType.connectionTimeout),
          fallback: fallback,
        ),
        contains('belum dapat dihubungi'),
      );
      expect(tapGoGenericErrorMessage(StateError('x'), fallback: fallback),
          fallback);
    });
  });

  group('ppobErrorMessage', () {
    test('kode domain PPOB_* memakai pesan server (Indonesia)', () {
      expect(
        ppobErrorMessage(const PpobApiException(
            code: 'PPOB_TARGET_INVALID', message: 'Nomor tujuan tidak valid')),
        'Nomor tujuan tidak valid',
      );
    });

    test('kode umum berbahasa Inggris diganti kalimat Indonesia', () {
      expect(
        ppobErrorMessage(const PpobApiException(
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            statusCode: 400)),
        'Terjadi kesalahan. Silakan coba lagi.',
      );
      expect(
        ppobErrorMessage(const PpobApiException(
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Unexpected server error',
            statusCode: 500)),
        contains('sedang bermasalah'),
      );
      expect(
        ppobErrorMessage(const PpobApiException(
            code: 'X', message: 'Too many requests', statusCode: 429)),
        contains('Terlalu banyak'),
      );
    });
  });
}
