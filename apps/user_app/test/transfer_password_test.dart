import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

DioException _apiError(String code) {
  final request = RequestOptions(path: '/wallet/transfer');
  return DioException(
    requestOptions: request,
    response: Response<Map<String, dynamic>>(
      requestOptions: request,
      statusCode: 403,
      data: {'success': false, 'code': code, 'message': 'x'},
    ),
    type: DioExceptionType.badResponse,
  );
}

void main() {
  test('transfer: password salah dijelaskan kepada pengguna', () {
    expect(
      tapGoTransferErrorMessage(_apiError('TRANSFER_PASSWORD_INVALID')),
      'Password tidak sesuai.',
    );
  });

  test('transfer: saldo sedang berubah memakai pesan coba lagi', () {
    expect(
      tapGoTransferErrorMessage(_apiError('TRANSFER_BALANCE_BUSY')),
      contains('Coba lagi'),
    );
  });
}
