import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Regresi driver_app 1.0.0+4 (4 Okt 2026) dan audit pin user_app: pin TLS
/// yang tidak cocok dengan sertifikat server membuat SETIAP permintaan gagal
/// handshake, dan semua pemeta pesan menampilkannya sebagai gangguan sinyal
/// ("Server TapGo belum dapat dihubungi"). Tes ini memakai server HTTPS lokal
/// sungguhan + sertifikat sintetis yang dibuat `openssl` saat tes berjalan
/// (tidak ada kunci privat di repo), jadi yang diuji adalah handshake dart:io
/// yang sebenarnya melalui kode pinning aplikasi.

class _Cert {
  _Cert(this.certPath, this.keyPath, this.spkiSha256Hex);
  final String certPath;
  final String keyPath;
  final String spkiSha256Hex;
}

/// Hash SPKI dihitung lewat openssl (alat independen), BUKAN lewat fungsi
/// pin aplikasi yang sedang diuji.
Future<_Cert> _makeCert(Directory dir, String name) async {
  final cert = '${dir.path}/$name.crt';
  final key = '${dir.path}/$name.key';
  final gen = await Process.run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', //
    '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost',
  ]);
  if (gen.exitCode != 0) fail('openssl req gagal: ${gen.stderr}');
  final hash = await Process.run('sh', [
    '-c',
    'openssl x509 -in "$cert" -pubkey -noout | '
        'openssl pkey -pubin -outform der | openssl dgst -sha256',
  ]);
  if (hash.exitCode != 0) fail('openssl dgst gagal: ${hash.stderr}');
  final hex = RegExp(r'[0-9a-f]{64}').firstMatch('${hash.stdout}')!.group(0)!;
  return _Cert(cert, key, hex);
}

Future<HttpServer> _httpsServer(_Cert cert) async {
  final context = SecurityContext()
    ..useCertificateChain(cert.certPath)
    ..usePrivateKey(cert.keyPath);
  final server = await HttpServer.bindSecure('127.0.0.1', 0, context);
  server.listen((request) {
    request.response
      ..statusCode = 200
      ..headers.contentType = ContentType.json
      ..write(jsonEncode({'success': true}));
    request.response.close();
  });
  return server;
}

Future<DioException> _failure(Dio dio) async {
  try {
    await dio.get<dynamic>('/ping');
  } on DioException catch (error) {
    return error;
  }
  fail('permintaan seharusnya gagal dengan DioException');
}

const _networkMessage = 'belum dapat dihubungi';

void main() {
  late Directory certDir;
  late _Cert certA;
  late _Cert certB;
  final servers = <HttpServer>[];

  setUpAll(() async {
    certDir = await Directory.systemTemp.createTemp('tapgo-user-tls-test');
    certA = await _makeCert(certDir, 'a');
    certB = await _makeCert(certDir, 'b');
  });

  tearDownAll(() async {
    await certDir.delete(recursive: true);
  });

  tearDown(() async {
    for (final server in servers) {
      await server.close(force: true);
    }
    servers.clear();
  });

  Future<String> serve() async {
    final server = await _httpsServer(certA);
    servers.add(server);
    return 'https://localhost:${server.port}';
  }

  group('pinning pada handshake sungguhan', () {
    test('pin cocok dengan SPKI server: permintaan berhasil', () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), pins: {certA.spkiSha256Hex});
      final response = await dio.get<dynamic>('/ping');
      expect(response.statusCode, 200);
    });

    test('pin basi (SPKI lain) dikenali sebagai pinMismatch', () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), pins: {certB.spkiSha256Hex});
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), TapGoTlsFailure.pinMismatch);
      final message = tapGoTlsFailureMessage(error)!;
      expect(message, contains('Perbarui'));
      expect(message, isNot(contains(_networkMessage)));
    });

    test('kegagalan TLS yang BUKAN penolakan pin (pinning aktif) menjadi certificateInvalid',
        () async {
      // Dio mengeluarkan DioExceptionType.unknown + HandshakeException untuk
      // SEMUA kegagalan TLS, termasuk penolakan pin, jadi penolakan pin dikenali
      // dari callback pin. Di sini handshake gagal sebelum callback dipanggil
      // (server HTTP biasa dihubungi lewat https). Pesan "perbarui dari Google
      // Play" hanya untuk penolakan pin.
      final plain = await HttpServer.bind('127.0.0.1', 0);
      plain.listen((request) {
        request.response.write('{}');
        request.response.close();
      });
      try {
        final dio = tapGoPinnedDioForTests(
            baseUrl: 'https://localhost:${plain.port}',
            pins: {certA.spkiSha256Hex});
        final error = await _failure(dio);
        expect(tapGoTlsFailureOf(error), TapGoTlsFailure.certificateInvalid);
        final message = tapGoTlsFailureMessage(error)!;
        expect(message, contains('tanggal dan jam'));
        expect(message, contains('belum tentu'));
        expect(message, isNot(contains('Google Play')));
      } finally {
        await plain.close(force: true);
      }
    });

    test('pin kosong pada build rilis dikenali sebagai pinNotConfigured',
        () async {
      final dio =
          tapGoPinnedDioForTests(baseUrl: await serve(), pins: <String>{});
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), TapGoTlsFailure.pinNotConfigured);
      expect(tapGoTlsFailureMessage(error), contains('belum dikonfigurasi'));
    });

    test('tanpa pinning, sertifikat self-signed dikenali sebagai certificateInvalid',
        () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), pins: <String>{}, enforce: false);
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), TapGoTlsFailure.certificateInvalid);
      expect(tapGoTlsFailureMessage(error), contains('tanggal dan jam'));
    });

    test('server mati BUKAN kegagalan TLS: tetap gangguan jaringan biasa',
        () async {
      final server = await _httpsServer(certA);
      final url = 'https://localhost:${server.port}';
      await server.close(force: true);
      final dio = tapGoPinnedDioForTests(baseUrl: url, pins: {certA.spkiSha256Hex});
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), isNull);
      expect(tapGoTlsFailureMessage(error), isNull);
    });
  });

  group('semua pemeta pesan menampilkan diagnosis TLS, bukan "tidak dapat dihubungi"',
      () {
    late DioException mismatch;

    setUp(() async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), pins: {certB.spkiSha256Hex});
      mismatch = await _failure(dio);
    });

    void expectTls(String message, String label) {
      expect(message, contains('Perbarui aplikasi'), reason: label);
      expect(message, isNot(contains(_networkMessage)), reason: label);
    }

    test('login/daftar', () {
      expectTls(tapGoAuthErrorMessage(mismatch, isRegister: false), 'login');
      expectTls(tapGoAuthErrorMessage(mismatch, isRegister: true), 'daftar');
    });
    test('pemulihan, verifikasi, ubah password', () {
      expectTls(tapGoRecoveryErrorMessage(mismatch), 'pemulihan');
      expectTls(tapGoVerificationErrorMessage(mismatch), 'verifikasi');
      expectTls(tapGoChangePasswordErrorMessage(mismatch), 'ubah password');
    });
    test('perjalanan, transfer, pesan umum', () {
      expectTls(tapGoRideErrorMessage(mismatch), 'perjalanan');
      expectTls(tapGoTransferErrorMessage(mismatch), 'transfer');
      expectTls(
          tapGoGenericErrorMessage(mismatch, fallback: 'Aksi belum berhasil.'),
          'umum');
    });
    test('PPOB', () {
      final mapped = tapGoMapPpobError(mismatch);
      expect(mapped.code, 'TLS_PIN_MISMATCH');
      expectTls(mapped.message, 'ppob');
    });
  });

  group('gangguan jaringan biasa tetap memakai pesan lama', () {
    final network = DioException(
      requestOptions: RequestOptions(path: '/x'),
      type: DioExceptionType.connectionError,
      error: const SocketException('tidak ada sinyal'),
    );

    test('login, pemulihan, ubah password, perjalanan, umum', () {
      expect(tapGoAuthErrorMessage(network, isRegister: false),
          contains(_networkMessage));
      expect(tapGoRecoveryErrorMessage(network), contains(_networkMessage));
      expect(tapGoChangePasswordErrorMessage(network), contains(_networkMessage));
      expect(tapGoRideErrorMessage(network), contains('terputus'));
      expect(tapGoGenericErrorMessage(network, fallback: 'x'),
          contains(_networkMessage));
    });
    test('PPOB', () {
      expect(tapGoMapPpobError(network).code, 'NETWORK_ERROR');
    });
  });
}
