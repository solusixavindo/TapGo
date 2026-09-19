import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

/// Uji akar aturan fail-closed/fail-open sesi (Stage R2 Auth Session
/// Persistence). _isAuthRejection adalah satu-satunya tempat yang memutuskan
/// apakah kegagalan validasi sesi berarti "server menolak kredensial secara
/// tegas" (harus fail-closed, sesi wajib dihapus) atau "gangguan sementara"
/// (boleh dipertahankan, dicoba lagi nanti) — baik _SessionBootstrap._restore
/// (cold start) maupun alur refresh token memakai fungsi yang sama ini.
void main() {
  group('tapGoIsAuthRejectionForTests (fail-closed boundary)', () {
    test('401 dari backend adalah penolakan tegas (fail-closed)', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/auth/me'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/me'),
          statusCode: 401,
        ),
      );
      expect(tapGoIsAuthRejectionForTests(error), isTrue);
    });

    test('403 dari backend adalah penolakan tegas (fail-closed)', () {
      final error = DioException(
        requestOptions: RequestOptions(path: '/auth/me'),
        response: Response(
          requestOptions: RequestOptions(path: '/auth/me'),
          statusCode: 403,
        ),
      );
      expect(tapGoIsAuthRejectionForTests(error), isTrue);
    });

    test(
      '5xx (server bermasalah) BUKAN penolakan tegas — sesi dipertahankan',
      () {
        final error = DioException(
          requestOptions: RequestOptions(path: '/auth/me'),
          response: Response(
            requestOptions: RequestOptions(path: '/auth/me'),
            statusCode: 500,
          ),
        );
        expect(tapGoIsAuthRejectionForTests(error), isFalse);
      },
    );

    test(
      'timeout/putus jaringan (tanpa response) BUKAN penolakan tegas',
      () {
        final error = DioException(
          requestOptions: RequestOptions(path: '/auth/me'),
          type: DioExceptionType.connectionTimeout,
        );
        expect(tapGoIsAuthRejectionForTests(error), isFalse);
      },
    );

    test(
      'error non-Dio (mis. FormatException dari respons rusak) BUKAN '
      'penolakan tegas — kegagalan mem-parse bukan bukti sesi tidak sah',
      () {
        expect(
          tapGoIsAuthRejectionForTests(const FormatException('bad json')),
          isFalse,
        );
      },
    );
  });

  group('Session JSON round-trip (dasar persistensi lintas restart)', () {
    test('token tidak pernah hilang atau berubah lewat serialisasi', () {
      final session = DemoClientSession.initial().copyWith(
        userId: 'user-1',
        accessToken: 'access-xyz',
        refreshToken: 'refresh-xyz',
        phone: '+6281200000000',
      );
      final restored = tapGoSessionFromJsonForTests(
        tapGoSessionToJsonForTests(session),
      );
      expect(restored.accessToken, 'access-xyz');
      expect(restored.refreshToken, 'refresh-xyz');
      expect(restored.userId, 'user-1');
    });

    test('sesi tanpa token (belum pernah login) tidak memalsukan token', () {
      final session = DemoClientSession.initial();
      final restored = tapGoSessionFromJsonForTests(
        tapGoSessionToJsonForTests(session),
      );
      expect(restored.accessToken, isNull);
      expect(restored.refreshToken, isNull);
    });
  });
}
