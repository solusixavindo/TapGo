import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Diagnosis galat TLS user_app.
///
/// Riwayat: pinning SPKI leaf lewat badCertificateCallback tidak pernah cocok
/// terhadap rantai produksi (callback menerima sertifikat TERATAS, bukan leaf),
/// dan semua pemeta pesan menampilkan kegagalannya sebagai gangguan sinyal
/// ("Server TapGo belum dapat dihubungi"). Desain sekarang: sertifikat CA
/// dipasang sebagai satu-satunya trust anchor. Tes ini memakai server HTTPS
/// lokal sungguhan dengan rantai SEBENARNYA (CA sintetis + leaf bertanda tangan
/// CA, SAN localhost) yang dibuat `openssl` saat tes berjalan (tidak ada kunci
/// privat di repo), jadi yang diuji adalah handshake dart:io yang sebenarnya.

/// CA sintetis dan leaf bertanda tangan CA itu (CN dan SAN `localhost`).
class _TestPki {
  _TestPki(this.caPem, this.leafCertPath, this.leafKeyPath);
  final String caPem;
  final String leafCertPath;
  final String leafKeyPath;
}

Future<void> _openssl(List<String> args) async {
  final result = await Process.run('openssl', args);
  if (result.exitCode != 0) {
    fail('openssl ${args.take(2).join(' ')} gagal: ${result.stderr}');
  }
}

Future<_TestPki> _makePki(Directory dir, String name) async {
  final d = dir.path;
  File('$d/$name-ca.cnf').writeAsStringSync(
      '[req]\ndistinguished_name=dn\n[dn]\n[v3_ca]\n'
      'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  File('$d/$name-leaf.cnf').writeAsStringSync(
      'subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\n'
      'extendedKeyUsage=serverAuth\n');
  await _openssl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', //
    '-keyout', '$d/$name-ca.key', '-out', '$d/$name-ca.crt', '-days', '2',
    '-subj', '/CN=TapGo-Test-CA-$name', '-config', '$d/$name-ca.cnf',
    '-extensions', 'v3_ca',
  ]);
  await _openssl([
    'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', '$d/$name-leaf.key',
    '-out', '$d/$name-leaf.csr', '-subj', '/CN=localhost',
  ]);
  await _openssl([
    'x509', '-req', '-in', '$d/$name-leaf.csr', '-CA', '$d/$name-ca.crt',
    '-CAkey', '$d/$name-ca.key', '-CAcreateserial', '-out',
    '$d/$name-leaf.crt', '-days', '2', '-extfile', '$d/$name-leaf.cnf',
  ]);
  return _TestPki(File('$d/$name-ca.crt').readAsStringSync(),
      '$d/$name-leaf.crt', '$d/$name-leaf.key');
}

Future<HttpServer> _httpsServer(_TestPki pki) async {
  final context = SecurityContext()
    ..useCertificateChain(pki.leafCertPath)
    ..usePrivateKey(pki.leafKeyPath);
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
  late _TestPki pkiA;
  late _TestPki pkiB;
  final servers = <HttpServer>[];

  setUpAll(() async {
    certDir = await Directory.systemTemp.createTemp('tapgo-user-tls-test');
    pkiA = await _makePki(certDir, 'a');
    pkiB = await _makePki(certDir, 'b');
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
    final server = await _httpsServer(pkiA);
    servers.add(server);
    return 'https://localhost:${server.port}';
  }

  group('pinning pada handshake sungguhan', () {
    test('anchor = CA yang menandatangani server: permintaan berhasil', () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), anchors: [pkiA.caPem]);
      final response = await dio.get<dynamic>('/ping');
      expect(response.statusCode, 200);
    });

    test('beberapa anchor: cukup satu yang menandatangani server', () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), anchors: [pkiB.caPem, pkiA.caPem]);
      final response = await dio.get<dynamic>('/ping');
      expect(response.statusCode, 200);
    });

    test('sertifikat sah tetapi untuk host lain ditolak (hostname diperiksa)',
        () async {
      final server = await _httpsServer(pkiA);
      servers.add(server);
      final dio = tapGoPinnedDioForTests(
          baseUrl: 'https://127.0.0.1:${server.port}', anchors: [pkiA.caPem]);
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), isNotNull);
    });

    test('anchor CA lain dikenali sebagai pinMismatch', () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), anchors: [pkiB.caPem]);
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
            anchors: [pkiA.caPem]);
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

    test('anchor kosong pada build rilis dikenali sebagai pinNotConfigured',
        () async {
      final dio =
          tapGoPinnedDioForTests(baseUrl: await serve(), anchors: <String>[]);
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), TapGoTlsFailure.pinNotConfigured);
      expect(tapGoTlsFailureMessage(error), contains('belum dikonfigurasi'));
    });

    test('tanpa pinning, sertifikat self-signed dikenali sebagai certificateInvalid',
        () async {
      final dio = tapGoPinnedDioForTests(
          baseUrl: await serve(), anchors: <String>[], enforce: false);
      final error = await _failure(dio);
      expect(tapGoTlsFailureOf(error), TapGoTlsFailure.certificateInvalid);
      expect(tapGoTlsFailureMessage(error), contains('tanggal dan jam'));
    });

    test('server mati BUKAN kegagalan TLS: tetap gangguan jaringan biasa',
        () async {
      final server = await _httpsServer(pkiA);
      final url = 'https://localhost:${server.port}';
      await server.close(force: true);
      final dio = tapGoPinnedDioForTests(baseUrl: url, anchors: [pkiA.caPem]);
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
          baseUrl: await serve(), anchors: [pkiB.caPem]);
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
